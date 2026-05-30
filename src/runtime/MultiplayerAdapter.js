// Client-side WebSocket adapter for TUIFY multiplayer.
// One adapter lives per world session and reconnects automatically on level change.
// Throttles outgoing state to SEND_HZ to avoid flooding the relay.

const SEND_HZ      = 20;
const SEND_MS      = 1000 / SEND_HZ;
const RETRY_DELAYS = [500, 1000, 2000, 5000, 10000];

export class MultiplayerAdapter {
  /**
   * @param {object} opts
   * @param {string} opts.wsBase    - e.g. "ws://localhost:3002/mp"
   * @param {string} opts.slug      - published game slug
   * @param {string} opts.levelId   - current level id
   * @param {string} opts.username  - local player's display name
   * @param {function} [opts.onRoom]   - ({myId, players}) initial room snapshot
   * @param {function} [opts.onJoin]   - ({id, username}) remote player joined
   * @param {function} [opts.onLeave]  - ({id}) remote player left
   * @param {function} [opts.onState]  - ({id, x, y, anim, dir, hp}) state update
   * @param {function} [opts.onAction] - ({id, act, data}) action event
   * @param {function} [opts.onError]  - (msg) server error string
   */
  constructor({ wsBase, slug, levelId, username, onRoom, onJoin, onLeave, onState, onAction, onError }) {
    this._wsBase   = wsBase;
    this._slug     = slug;
    this._levelId  = levelId;
    this._username = username || 'Player';

    this._onRoom   = onRoom   || (() => {});
    this._onJoin   = onJoin   || (() => {});
    this._onLeave  = onLeave  || (() => {});
    this._onState  = onState  || (() => {});
    this._onAction = onAction || (() => {});
    this._onError  = onError  || (() => {});

    /** Public: local player's server-assigned id */
    this.myId = null;
    /** Public: Map<playerId, { username, x, y, anim, dir, hp, lx, ly }> */
    this.remotePlayers = new Map();

    this._ws           = null;
    this._destroyed    = false;
    this._retryIdx     = 0;
    this._retryTimer   = null;
    this._lastSendMs   = 0;
    this._entityTpl    = null; // sent once on join so others can render us
    this._connected    = false;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  connect() {
    if (this._destroyed) return;
    this._open();
  }

  /**
   * Call when the player switches to a new level.
   * Clears remote players and reconnects to the new room.
   */
  changeLevel(levelId) {
    this._levelId = levelId;
    this.remotePlayers.clear();
    this._retryIdx = 0;
    this._cancelRetry();
    this._open();
  }

  /**
   * Set the entity template (renderSize, spriteSheetAssetId, animations, color).
   * Sent once when the WS connection opens so peers know how to render us.
   */
  setEntityTemplate(tpl) {
    this._entityTpl = tpl;
  }

  /**
   * Send local player state. Call every frame — adapter throttles internally.
   * @param {{ x, y, anim, dir, hp }} state
   */
  sendState(state) {
    const now = performance.now();
    if (now - this._lastSendMs < SEND_MS) return;
    this._lastSendMs = now;
    this._send({ t: 'state', ...state });
  }

  /**
   * Broadcast an action event (attack, pickup, etc.) to all peers.
   * @param {string} act  - action name
   * @param {object} data - action payload
   */
  sendAction(act, data) {
    this._send({ t: 'action', act, data });
  }

  destroy() {
    this._destroyed = true;
    this._cancelRetry();
    if (this._ws) { try { this._ws.close(); } catch {} this._ws = null; }
    this.remotePlayers.clear();
  }

  get isConnected() { return this._connected; }
  get playerCount() { return this.remotePlayers.size; }

  // ── Private ──────────────────────────────────────────────────────────────

  _open() {
    if (this._ws) {
      try { this._ws.close(); } catch {}
      this._ws = null;
    }
    this._connected = false;

    const url = `${this._wsBase}/${this._slug}/${this._levelId}`;
    let ws;
    try { ws = new WebSocket(url); } catch { this._scheduleRetry(); return; }
    this._ws = ws;

    ws.onopen = () => {
      this._connected = true;
      this._retryIdx = 0;
      // Announce ourselves
      ws.send(JSON.stringify({ t: 'join', username: this._username, entityTemplate: this._entityTpl }));
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this._recv(msg);
    };

    ws.onclose = () => {
      this._connected = false;
      if (!this._destroyed) this._scheduleRetry();
    };

    ws.onerror = () => {}; // onclose fires too
  }

  _recv(msg) {
    switch (msg.t) {
      case 'room': {
        this.myId = msg.myId;
        this.remotePlayers.clear();
        for (const p of (msg.players || [])) {
          this._upsertRemote(p.id, p);
          if (p.state) this._applyState(p.id, p.state);
        }
        this._onRoom(msg);
        break;
      }
      case 'join':
        this._upsertRemote(msg.id, msg);
        this._onJoin(msg);
        break;
      case 'leave':
        this.remotePlayers.delete(msg.id);
        this._onLeave(msg);
        break;
      case 'state':
        this._applyState(msg.id, msg);
        this._onState(msg);
        break;
      case 'action':
        this._onAction(msg);
        break;
      case 'error':
        this._onError(msg.msg || 'error');
        break;
    }
  }

  _upsertRemote(id, data) {
    if (!this.remotePlayers.has(id)) {
      this.remotePlayers.set(id, {
        username: data.username || 'Player',
        entityTemplate: data.entityTemplate || null,
        // current interpolated position
        x: 0, y: 0,
        // target position (latest received)
        tx: 0, ty: 0,
        anim: null, dir: 1, hp: 100,
        _color: playerColor(id),
      });
    } else {
      const rp = this.remotePlayers.get(id);
      if (data.username) rp.username = data.username;
      if (data.entityTemplate) rp.entityTemplate = data.entityTemplate;
    }
  }

  _applyState(id, s) {
    let rp = this.remotePlayers.get(id);
    if (!rp) { this._upsertRemote(id, {}); rp = this.remotePlayers.get(id); }
    rp.tx   = Number(s.x)   || rp.tx || 0;
    rp.ty   = Number(s.y)   || rp.ty || 0;
    rp.anim = s.anim  ?? rp.anim;
    rp.dir  = s.dir   ?? rp.dir;
    rp.hp   = s.hp    ?? rp.hp;
    // First state: teleport to position instantly
    if (rp.x === 0 && rp.y === 0) { rp.x = rp.tx; rp.y = rp.ty; }
  }

  _send(obj) {
    if (this._ws?.readyState === 1 /* OPEN */) {
      try { this._ws.send(JSON.stringify(obj)); } catch {}
    }
  }

  _scheduleRetry() {
    this._cancelRetry();
    const delay = RETRY_DELAYS[Math.min(this._retryIdx++, RETRY_DELAYS.length - 1)];
    this._retryTimer = setTimeout(() => this._open(), delay);
  }

  _cancelRetry() {
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
  }
}

// Deterministic color per player id
function playerColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue},75%,58%)`;
}
