// Game runtime. Pure JS, no React. Owns a tick loop driven by
// requestAnimationFrame, an internal clone of the level state, an input
// map, and the draw routines. The RuntimeView React wrapper attaches a
// canvas, forwards keyboard input, and calls start()/stop() around its
// lifecycle.
//
// Coordinate convention (matches the editor):
//   - World pixel space, top-left origin internally.
//   - Tilemap data row 0 is the floor (bottom of the canvas); the runtime
//     flips Y when reading layer.data so falling entities collide there.
//   - Gravity > 0 → platformer. Gravity = 0 → top-down (Up/Down move).

import { resolveTilesetView, cellOrigin } from '../lib/tilesetView';
import { loadMaskedImage } from '../lib/imageMask';
import { BUILTIN_MACHINE_SOUNDS } from '../lib/interactionAudio';

// ── Geometry helpers for line-segment collision ─────────────────────────────
function cross2d(ax, ay, bx, by) { return ax * by - ay * bx; }
function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = cross2d(bx-ax, by-ay, cx-ax, cy-ay);
  const d2 = cross2d(bx-ax, by-ay, dx-ax, dy-ay);
  const d3 = cross2d(dx-cx, dy-cy, ax-cx, ay-cy);
  const d4 = cross2d(dx-cx, dy-cy, bx-cx, by-cy);
  return ((d1>0&&d2<0)||(d1<0&&d2>0)) && ((d3>0&&d4<0)||(d3<0&&d4>0));
}
function aabbVsSegment(x, y, w, h, px, py, qx, qy) {
  if (segmentsIntersect(x,   y,   x+w, y,   px, py, qx, qy)) return true;
  if (segmentsIntersect(x+w, y,   x+w, y+h, px, py, qx, qy)) return true;
  if (segmentsIntersect(x+w, y+h, x,   y+h, px, py, qx, qy)) return true;
  if (segmentsIntersect(x,   y+h, x,   y,   px, py, qx, qy)) return true;
  return (px >= x && px <= x+w && py >= y && py <= y+h) ||
         (qx >= x && qx <= x+w && qy >= y && qy <= y+h);
}

export function resolveRunnerLaneIndex(runnerLane, laneCount, anyIndex = null) {
  const lanes = Math.max(1, Number(laneCount) || 1);
  const raw = typeof runnerLane === 'string' ? runnerLane.trim().toLowerCase() : runnerLane;
  if (raw === 'any' || raw === '' || raw === undefined || raw === null) {
    const idx = anyIndex === null || anyIndex === undefined
      ? Math.floor(Math.random() * lanes)
      : Math.floor(Number(anyIndex) || 0);
    return ((idx % lanes) + lanes) % lanes;
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(lanes - 1, Math.floor(numeric)));
}

export class GameRuntime {
  constructor({ level, assets, canvas, onNextLevel, onNavigateLevel, onGameStateChange, worldSettings, mobileViewport, mpAdapter }) {
    this.level = level;
    this.assets = assets;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onNextLevel = onNextLevel || null;
    this.onNavigateLevel = onNavigateLevel || null;
    this.onGameStateChange = onGameStateChange || null;
    this.worldSettings = worldSettings || {};
    // Multiplayer adapter — null in builder preview, set in published standalone games
    this.mpAdapter = mpAdapter || null;

    // Mobile viewport defines the canvas SIZE (renderWidth × renderHeight).
    // World always renders at 1:1 pixel scale — the camera scrolls to follow the
    // player, matching exactly what the editor canvas shows at any given position.
    // No zoom transform is applied so editor coordinates and runtime coordinates
    // are identical and colliders/backgrounds align without adjustment.
    this._renderScale   = 1;
    this._renderOffsetX = 0;
    this._renderOffsetY = 0;

    // Clone entity state so we never mutate editor state.
    this.entities = (level.entities || []).map(e => ({
      ...e,
      position: { ...(e.position || { x: 0, y: 0 }) },
      velocity: { x: 0, y: 0 },
      onGround: false,
      _airborneFrames: 0,
      _hitState: { timeLeft: 0, anim: null },
      _invincibleTime: 0,
      _hp: e.stats?.hp ?? 100,
      _dead: false,
      _vanished: false,         // true after death + vanish delay expires
      _vanishTimeLeft: 0,       // countdown to removal (0 = never auto-vanish)
      _deathAction: null,       // action to fire when entity finishes dying
      // Combo / multi-attack state (player)
      _comboState: null,        // { attackId, attackTimeLeft, windowLeft, nextAttackId, comboWindowDur }
      _idleState: { idx: 0, timer: 0 }, // cycling idles
      // Platformer intelligence
      _coyoteTimer:  0,    // grace-jump window after walking off an edge (seconds)
      _jumpBuffer:   0,    // buffered jump input while airborne (seconds)
      _wasOnGround:  false,
      _powerups:     {},   // { grow:{timeLeft}, star:{timeLeft}, fire:{timeLeft} }
      // Enemy AI state
      _aiState: 'patrol',
      _spawnX: e.position?.x ?? 0,
      _patrolDir: 1,
      _patrolFlipCooldown: 0,
      _attackCooldown: 0,
      _attackHitSet: null,
      currentAnim: e.defaultAnimation || e.animations?.[0]?.name || null,
      animFrame: 0,
      animTime: 0,
      facing: e.facing || 'right',
    }));

    // Spawn positions for restart-level — keyed by entity id.
    this._spawnStates = new Map((level.entities || []).map(e => [e.id, {
      position: { ...(e.position || { x: 0, y: 0 }) },
      _hp: e.stats?.hp ?? 100,
      _dead: false,
      _vanished: false,
    }]));

    // Game state — score, lives, timer, win/lose flags.
    this.gameState = {
      score: 0,
      lives: level.gameSettings?.lives ?? 3,
      coins: 0,
      timer: level.gameSettings?.timerSeconds ?? 0,
      timerRunning: !!(level.gameSettings?.timerSeconds),
      checkpointX: null,
      checkpointY: null,
      levelComplete: false,
      gameOver: false,
      flashScreen: 0, // seconds of flash overlay remaining
      // Top-down / Vampire Survivors
      xp: 0, xpLevel: 1, xpToNext: 100,
      wave: 0,
    };

    this.input = { left: false, right: false, up: false, down: false, jump: false, attack: false, interact: false, dash: false };
    this._prevAttackInput  = false;
    this._prevInteractInput = false;
    this.cameraX = 0;
    this.cameraY = 0;
    this.time = 0;
    this.lastT = 0;
    this.rafId = null;
    this.running = false;
    this.showColliders = false;
    this.images = new Map(); // assetId → HTMLImageElement | HTMLCanvasElement
    this._idleSounds    = new Map(); // entityId → HTMLAudioElement (looping per-entity sounds)
    this._audioUnlocked = false;    // true after first user gesture (browser autoplay policy)

    // Arcade mode — set from worldSettings.gameType. Activates dedicated update/draw paths.
    // Only genres with a real _initArcade / _updateArcade implementation get this flag.
    // Platformer, top-down, and fighting use the normal physics loop regardless of gameType.
    const ARCADE_GENRES = new Set([
      'casual.flappy-bird', 'casual.endless-score',
      'arcade.space-invaders', 'arcade.pac-man', 'arcade.snake',
      'arcade.breakout', 'arcade.pong',
      'strategy.tower-defense', 'strategy.match-3',
      'card.blackjack', 'card.solitaire',
      'racing.top-down', 'racing.endless',
      'rhythm.lane-tap',
      'fighting.brawler',
    ]);
    const gt = worldSettings?.gameType || {};
    this._gameType = gt;
    const _rawMode = (gt.primary && gt.secondary) ? `${gt.primary}.${gt.secondary}` : null;
    this.arcadeMode = (_rawMode && ARCADE_GENRES.has(_rawMode)) ? _rawMode : null;
    this._arcadeState = {};
    this._prevFlappyJump = false;
    this._prevSiAttack   = false;
    if (this.arcadeMode) this._initArcade();

    // Phase H — Top-Down Intelligence: projectiles, wave spawner, Vampire Survivors.
    this._projectiles      = [];
    this._xpGems           = [];
    this._aimDir           = { x: 0, y: 1 };
    this._vampireAutoTimer = 0;
    this._waveTimer        = 0;
    this._waveIndex        = 0;
    this._prevFireInput    = false;

    this.preloadPromise = this.preload();
  }

  setShowColliders(v) { this.showColliders = v; }

  // Public: called by RuntimeView/EmbedRuntime on mousemove/touchmove.
  // dx/dy are world-space direction from player to cursor; do not need to be normalised.
  setAimDirection(dx, dy) {
    const len = Math.hypot(dx, dy);
    if (len > 0.01) { this._aimDir.x = dx / len; this._aimDir.y = dy / len; }
  }

  // Full AABB check against solid (non-one-way) segment shapes only.
  segmentCollide(x, y, w, h) {
    for (const shape of (this.level.colliderShapes || [])) {
      if (shape.oneWay) continue; // one-way shapes use oneWayBottomCross, not AABB
      const pts = shape.points || [];
      const n = pts.length;
      if (n < 2) continue;
      const limit = shape.closed ? n : n - 1;
      for (let i = 0; i < limit; i++) {
        const p0 = pts[i], p1 = pts[(i + 1) % n];
        if (aabbVsSegment(x, y, w, h, p0.x, p0.y, p1.x, p1.y)) return true;
      }
    }
    return false;
  }

  // One-way landing check: entity bottom was at/above the segment, and the new
  // position crosses below it. Uses per-segment Y interpolation at the entity's
  // center X — never fires from a lateral approach (AABB side touching the line).
  oneWayBottomCross(x, prevY, h, newY, w, onGround = false, maxStepUp = 2) {
    const prevBottom = prevY + h;
    const newBottom  = newY  + h;
    // When already standing on the slope, allow the bottom to be up to maxStepUp
    // pixels above the segment before we consider it "on top" — this keeps the
    // entity from falling through an upward-rising diagonal when moving sideways.
    const stepTol = onGround ? maxStepUp : 2;
    for (const shape of (this.level.colliderShapes || [])) {
      if (!shape.oneWay) continue;
      const pts = shape.points || [];
      const n = pts.length;
      if (n < 2) continue;
      const limit = shape.closed ? n : n - 1;
      for (let i = 0; i < limit; i++) {
        const p0 = pts[i], p1 = pts[(i + 1) % n];
        const sx0 = Math.min(p0.x, p1.x), sx1 = Math.max(p0.x, p1.x);
        if (sx1 - sx0 < 1) continue; // skip near-vertical segments
        if (x + w <= sx0 || x >= sx1) continue; // no horizontal overlap
        // Interpolate segment Y at the entity's horizontal centre (clamped to segment X range)
        const cx  = Math.max(sx0 + 0.5, Math.min(sx1 - 0.5, x + w / 2));
        const t   = (cx - p0.x) / (p1.x - p0.x);
        const segY = p0.y + t * (p1.y - p0.y);
        // Only land when coming from above: bottom was at/above segY (+ tolerance) and crosses below
        if (prevBottom <= segY + stepTol && newBottom > segY) return true;
      }
    }
    return false;
  }

  // Combined tile + segment check used by _applyPhysics (solid shapes only).
  collides(x, y, w, h, self = null) {
    return this.tileCollide(x, y, w, h) ||
           this.segmentCollide(x, y, w, h) ||
           this.entitySolidCollide(x, y, w, h, self);
  }

  entitySolidCollide(x, y, w, h, self = null) {
    for (const entity of this.entities || []) {
      if (entity === self || entity._vanished || entity._dead) continue;
      if (!this._isSolidEntity(entity)) continue;
      const ew = entity.renderSize?.width  || 32;
      const eh = entity.renderSize?.height || 32;
      if (x < entity.position.x + ew &&
          x + w > entity.position.x &&
          y < entity.position.y + eh &&
          y + h > entity.position.y) {
        return true;
      }
    }
    return false;
  }

  preload() {
    const queue = [];
    const ts = resolveTilesetView(this.assets, this.level.tileMap?.tilesetAssetId);
    if (ts?.src) queue.push([ts.id, ts.src, ts.transparentColor, ts.transparentTolerance || 0]);
    for (const e of this.entities) {
      // New multi-sheet format: load every sprite sheet referenced in animations.
      const sheetIds = new Set();
      for (const slot of (e.animations || [])) {
        if (slot.spriteSheetId) sheetIds.add(slot.spriteSheetId);
      }
      // Legacy fallback: single spriteSheetAssetId.
      if (e.spriteSheetAssetId) sheetIds.add(e.spriteSheetAssetId);
      for (const sid of sheetIds) {
        const sheet = (this.assets.sprites || []).find(s => s.id === sid);
        if (sheet?.src) queue.push([sheet.id, sheet.src, sheet.frame?.transparentColor, sheet.frame?.transparentTolerance || 0]);
      }
      // Static image for particle emitters (particleImageUrl stored on entity)
      if (e.particleImageUrl) queue.push([e.particleImageUrl, e.particleImageUrl, null, 0]);
    }
    for (const bg of this.level.backgrounds || []) {
      const a = (this.assets.backgrounds || []).find(x => x.id === bg.assetId);
      if (a?.src) queue.push([a.id, a.src, null, 0]);
      if (bg.assetIdPortrait) {
        const ap = (this.assets.backgrounds || []).find(x => x.id === bg.assetIdPortrait);
        if (ap?.src) queue.push([ap.id, ap.src, null, 0]);
      }
    }
    if (!queue.length) return Promise.resolve();
    return Promise.all(
      queue.map(([id, src, color, tol]) =>
        loadMaskedImage(src, color, tol).then(entry => {
          if (entry?.img) this.images.set(id, entry.img);
        })
      )
    );
  }

  // ── Multi-sheet animation helpers ─────────────────────────────────────────
  // Resolve which sprite sheet handles a named animation. Supports the new
  // per-animation slot format (entity.animations[]) and falls back to the
  // legacy entity.spriteSheetAssetId for entities created before this change.
  _getAnimSlot(entity, animName) {
    const slots = entity.animations || [];
    if (!slots.length) return null;
    return slots.find(a => a.name === animName) ||
           slots.find(a => a.name === entity.defaultAnimation) ||
           slots[0] ||
           null;
  }

  _getSheetForAnim(entity, animName) {
    if (entity.animations?.length) {
      const slot = this._getAnimSlot(entity, animName);
      if (slot?.spriteSheetId) {
        return (this.assets.sprites || []).find(s => s.id === slot.spriteSheetId) || null;
      }
    }
    return (this.assets.sprites || []).find(s => s.id === entity.spriteSheetAssetId) || null;
  }

  // Resolve the sheet-side animation definition for a named local animation.
  _getAnimDef(entity, animName) {
    if (entity.animations?.length) {
      const slot = this._getAnimSlot(entity, animName);
      if (slot) {
        const sheet = this._getSheetForAnim(entity, animName);
        return (sheet?.animations || []).find(a => a.name === slot.animName) ||
               (sheet?.animations || [])[0] ||
               null;
      }
    }
    const sheet = (this.assets.sprites || []).find(s => s.id === entity.spriteSheetAssetId);
    return (sheet?.animations || []).find(a => a.name === animName) ||
           (sheet?.animations || [])[0] ||
           null;
  }

  // Return a flat list of available local animation names for this entity.
  _getEntityAnimNames(entity) {
    if (entity.animations?.length) return entity.animations.map(a => a.name).filter(Boolean);
    const sheet = (this.assets.sprites || []).find(s => s.id === entity.spriteSheetAssetId);
    return (sheet?.animations || []).map(a => a.name);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    for (const audio of this._idleSounds.values()) {
      try { audio.pause(); } catch {}
    }
    this._idleSounds.clear();
  }

  // ── Game sound helpers ────────────────────────────────────────────────────
  _findSoundAsset(soundId) {
    if (!soundId) return null;
    return (this.assets.sounds || []).find(s => s.id === soundId)
      || BUILTIN_MACHINE_SOUNDS.find(s => s.id === soundId)
      || null;
  }

  _playGameSound(soundId, { loop = false, volume = 0.8 } = {}) {
    if (!soundId) return null;
    const asset = this._findSoundAsset(soundId);
    const src = asset?.src || asset?.url;
    if (!src) return null;
    try {
      const audio = new Audio(src);
      audio.loop   = loop;
      audio.volume = Math.max(0, Math.min(1, volume));
      const p = audio.play();
      if (p?.catch) p.catch(() => {});
      return audio;
    } catch { return null; }
  }

  _startEntityIdleSound(entity) {
    const soundId = entity.behavior?.sounds?.idle;
    if (!soundId) return;
    if (this._idleSounds.has(entity.id)) return;
    const asset = this._findSoundAsset(soundId);
    const src = asset?.src || asset?.url;
    if (!src) return;
    try {
      const audio = new Audio(src);
      audio.loop   = true;
      audio.volume = 0.6;
      this._idleSounds.set(entity.id, audio);
      const p = audio.play();
      // If blocked by autoplay policy, remove from map so setInput can retry
      // once the user provides their first gesture.
      if (p instanceof Promise) p.catch(() => this._idleSounds.delete(entity.id));
    } catch { }
  }

  _stopEntityIdleSound(entityId) {
    const audio = this._idleSounds.get(entityId);
    if (!audio) return;
    try { audio.pause(); audio.currentTime = 0; } catch {}
    this._idleSounds.delete(entityId);
  }

  setInput(action, pressed) {
    if (pressed && !this._audioUnlocked) {
      this._audioUnlocked = true;
      // Browser autoplay policy blocks audio before the first user gesture.
      // Now that one has happened, restart any idle sounds that were blocked.
      for (const entity of this.entities) {
        if (entity.behavior?.sounds?.idle && !this._idleSounds.has(entity.id)) {
          this._startEntityIdleSound(entity);
        }
      }
    }
    if (action in this.input) this.input[action] = pressed;
  }

  _getControlLayout() {
    return this.level.controlLayout ||
      this.worldSettings.controlLayout ||
      this.worldSettings.mobileControls?.layout ||
      '';
  }

  // ── Directional animation helpers ──────────────────────────────────────────

  // Returns the 8-directional facing string from velocity, or null if below threshold.
  // Possible values: 'right' 'left' 'up' 'down' 'up-right' 'up-left' 'down-right' 'down-left'
  _getFacingDir(vx, vy, threshold = 1) {
    const mx = Math.abs(vx) > threshold;
    const my = Math.abs(vy) > threshold;
    if (!mx && !my) return null;
    const h = mx ? (vx > 0 ? 'right' : 'left') : null;
    const v = my ? (vy > 0 ? 'down' : 'up') : null;
    if (h && v) return `${v}-${h}`; // e.g. 'down-right', 'up-left'
    return h || v;
  }

  // Resolves a directional animation variant for a given base action + direction.
  //
  // Naming convention (any separator: _ - .):
  //   walk_right  walk_left  walk_up   walk_down
  //   walk_up_right  walk_up_left  walk_down_right  walk_down_left
  //   Also accepts aliases: back/front for up/down; n/s/e/w/ne/nw/se/sw for compass.
  //
  // Falls back: exact 8-dir → dominant 4-dir axis (based on vx/vy magnitude) → null.
  _resolveDirectionalAnim(animNames, action, facingDir, vx = 0, vy = 0) {
    if (!facingDir || !animNames?.length) return null;
    const SUFFIXES = {
      'right':      ['right', 'r'],
      'left':       ['left',  'l'],
      'up':         ['up',    'u',  'north',     'n',  'back'],
      'down':       ['down',  'd',  'south',     's',  'front'],
      'up-right':   ['up_right',   'upright',   'northeast', 'ne', 'upper_right',  'ur'],
      'up-left':    ['up_left',    'upleft',    'northwest', 'nw', 'upper_left',   'ul'],
      'down-right': ['down_right', 'downright', 'southeast', 'se', 'lower_right',  'dr'],
      'down-left':  ['down_left',  'downleft',  'southwest', 'sw', 'lower_left',   'dl'],
    };
    const findFor = (dir) => {
      for (const s of (SUFFIXES[dir] || [])) {
        const found = animNames.find(n => {
          const norm = n.toLowerCase().replace(/[-\s]/g, '_');
          return norm === `${action}_${s}` || norm === `${action}.${s}`;
        });
        if (found) return found;
      }
      return null;
    };
    const exact = findFor(facingDir);
    if (exact) return exact;
    // Diagonal: fall back to dominant axis
    if (facingDir.includes('-')) {
      const [vert, horiz] = facingDir.split('-');
      const dominant  = Math.abs(vx) >= Math.abs(vy) ? horiz : vert;
      const secondary = dominant === horiz ? vert : horiz;
      return findFor(dominant) || findFor(secondary);
    }
    return null;
  }

  _getEffectivePhysics() {
    const rawGravity = Number(this.level.gravity) || 0;
    const layout = this._getControlLayout();
    const platformerLayout = ['platformer', 'platformer-dash', 'swipe-jump', 'tap-only'].includes(layout);
    const topDownLayout = ['topdown-action', 'topdown-move-only', 'dpad-only'].includes(layout);
    const platformerViewport = this.level.viewport === 'platformer';
    const gravity = rawGravity > 0 ? rawGravity : ((platformerLayout || platformerViewport) ? 800 : 0);
    return { gravity, isPlatformer: !topDownLayout && gravity > 0 };
  }

  _isSolidEntity(entity) {
    return entity?.solid === true || ['platform', 'wall', 'solid'].includes(entity?.role);
  }

  _findPlayer() {
    const explicit = this.entities.find(e => e.role === 'playerMain');
    if (explicit) return explicit;
    return this.entities.find(e =>
      e.type === 'GameEntity' &&
      !e._dead &&
      !e._vanished &&
      !this._isSolidEntity(e) &&
      !['enemy', 'collectible', 'spawnPoint', 'trigger', 'teleporter', 'particleEmitter', 'soundEmitter', 'npc', 'interactive'].includes(e.role)
    ) || null;
  }

  // ── Action event system ────────────────────────────────────────────────
  // Evaluates a string action from an entity event binding.
  _runAction(action) {
    if (!action || action === 'none') return;
    if (action.startsWith('goto-level:')) {
      const levelId = action.slice('goto-level:'.length);
      if (!levelId) return;
      this.stop();
      this.onNavigateLevel?.(levelId);
      return;
    }
    if (action.startsWith('add-score:')) {
      const n = parseInt(action.slice(10), 10);
      if (!isNaN(n)) {
        this.gameState.score += n;
        this._emitState();
        const ws = this.level.gameSettings?.winScore || 0;
        if (ws > 0 && this.gameState.score >= ws) this._runAction('next-level');
      }
      return;
    }
    switch (action) {
      case 'lose-life':
        this.gameState.lives = Math.max(0, this.gameState.lives - 1);
        if (this.gameState.lives === 0) {
          this.gameState.gameOver = true;
          this._emitState();
          this.stop();
        } else {
          this._emitState();
          this._resetLevel();
        }
        break;
      case 'game-over':
        this.gameState.gameOver = true;
        this._emitState();
        this.stop();
        break;
      case 'restart-level':
        this._resetLevel();
        break;
      case 'next-level':
        this.gameState.levelComplete = true;
        this._emitState();
        this.stop();
        this.onNextLevel?.();
        break;
      case 'add-life':
        this.gameState.lives++;
        this._emitState();
        break;
      case 'add-coin':
        this.gameState.coins++;
        this._emitState(); {
          const wc = this.level.gameSettings?.winCoins || 0;
          if (wc > 0 && this.gameState.coins >= wc) this._runAction('next-level');
        }
        break;
      case 'flash-screen':
        this.gameState.flashScreen = 0.4;
        break;
      case 'checkpoint': {
        const player = this._findPlayer();
        if (player) {
          this.gameState.checkpointX = player.position.x;
          this.gameState.checkpointY = player.position.y;
          this._emitState();
        }
        break;
      }
      default: break;
    }
  }

  _emitState() {
    this.onGameStateChange?.({ ...this.gameState });
  }

  _resetLevel() {
    this.gameState.flashScreen = 0.3;
    for (const entity of this.entities) {
      const spawn = this._spawnStates.get(entity.id);
      if (!spawn) continue;
      // Respawn player at checkpoint if one is set, otherwise at spawn position.
      if (entity === this._findPlayer() && this.gameState.checkpointX !== null) {
        entity.position.x = this.gameState.checkpointX;
        entity.position.y = this.gameState.checkpointY;
      } else {
        entity.position.x = spawn.position.x;
        entity.position.y = spawn.position.y;
      }
      entity._hp          = spawn._hp;
      entity._dead        = false;
      entity._vanished    = false;
      entity._deathAction = null;
      entity._aiState     = 'patrol';
      entity._invincibleTime = 0;
      entity.velocity.x   = 0;
      entity.velocity.y   = 0;
      entity.onGround      = false;
      entity._airborneFrames = 0;
      entity._hitState     = { timeLeft: 0, anim: null };
      entity.currentAnim   = entity.defaultAnimation || entity.animations?.[0]?.name || null;
      entity.animFrame     = 0;
      entity.animTime      = 0;
      entity._coyoteTimer  = 0;
      entity._jumpBuffer   = 0;
      entity._wasOnGround  = false;
      entity._powerups     = {};
    }
    if (this.arcadeMode) this._resetArcade();
    this._projectiles      = [];
    this._xpGems           = [];
    this._vampireAutoTimer = 0;
    this._waveTimer        = 0;
    this._waveIndex        = 0;
    this._runner           = null;
    if (!this.running) {
      this.running = true;
      this.lastT = performance.now();
      this.rafId = requestAnimationFrame(this.frame);
    }
  }

  getGameState() {
    return { ...this.gameState };
  }

  // Snapshot the runtime state for debug overlays. Cheap to call every
  // frame from a React parent; returns plain objects so React can shallow-
  // compare and avoid re-rendering when nothing changed.
  getDebugInfo() {
    const player = this._findPlayer();
    const enemies = this.entities.filter(e => e.role === 'enemy');
    const physics = this._getEffectivePhysics();
    return {
      input: { ...this.input },
      physics,
      camera: { x: Math.round(this.cameraX), y: Math.round(this.cameraY) },
      player: player ? {
        id: player.id,
        role: player.role,
        x: Math.round(player.position.x),
        y: Math.round(player.position.y),
        vx: Math.round(player.velocity.x),
        vy: Math.round(player.velocity.y),
        onGround: player.onGround,
        anim: player.currentAnim,
        frame: player.animFrame,
        hitState: player._hitState?.timeLeft > 0 ? player._hitState.anim : null,
        hp: player._hp,
      } : null,
      enemies: { total: enemies.length, alive: enemies.filter(e => !e._dead).length },
      gameState: { ...this.gameState },
    };
  }

  // Apply a hit to the player (called from the debug HUD test buttons).
  applyHit(power = 10) {
    const entity = this._findPlayer();
    if (entity) this.applyHitToEntity(entity, power);
  }

  frame = (t) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    this.time += dt;
    this.update(dt);
    if (this.mpAdapter) this._mpTick(dt);
    this.draw();
    this.rafId = requestAnimationFrame(this.frame);
  };

  // ── Simulation ─────────────────────────────────────────────────────────
  update(dt) {
    if (this.arcadeMode) { this._updateArcade(dt); return; }
    const { gravity, isPlatformer } = this._getEffectivePhysics();
    const tm = this.level.tileMap || {};
    const tileW = tm.tileWidth || 32;
    const tileH = tm.tileHeight || 32;
    const cols = tm.cols || 0;
    const rows = tm.rows || 0;
    const player = this._findPlayer();
    const attackEdge   = this.input.attack   && !this._prevAttackInput;
    const interactEdge = this.input.interact && !this._prevInteractInput;
    this._prevAttackInput  = this.input.attack;
    this._prevInteractInput = this.input.interact;
    for (const entity of this.entities) {
      if (entity._vanished) continue;
      if (entity._dead) { this._tickDeathSequence(entity, dt); continue; }
      if (entity === player) {
        this.updatePlayer(entity, dt, gravity, isPlatformer, tileW, tileH, cols, rows, attackEdge);
      } else if (entity.role === 'enemy') {
        if (player) this.updateEnemyAI(entity, player, dt, tileW, tileH);
        this._applyPhysics(entity, dt, gravity, isPlatformer, tileW, tileH, cols, rows);
        this.updateEnemyAnimation(entity, dt);
      } else {
        // Collectibles, powerups, NPCs, triggers, and any other static entity:
        // tick their animation so idle/floating animations play in runtime.
        this._tickEntityAnim(entity, dt);
      }
    }
    if (player && !player._dead) this.checkCombat(player, dt);

    // ── Enemy stomp ──────────────────────────────────────────────────────────
    // Falling player feet land on enemy top → enemy dies, player bounces.
    if (isPlatformer && player && !player._dead && !player._vanished &&
        player.velocity.y > 0 && (this.level.gravityDir || 'down') === 'down') {
      const pw   = player.renderSize?.width  || 32;
      const ph   = player.renderSize?.height || 32;
      const footY = player.position.y + ph;
      for (const entity of this.entities) {
        if (entity.role !== 'enemy' || entity._dead || entity._vanished) continue;
        const ew = entity.renderSize?.width  || 32;
        const eh = entity.renderSize?.height || 32;
        const headZone = Math.min(16, eh * 0.28); // only top 28% of enemy counts as stompable
        if (footY >= entity.position.y && footY <= entity.position.y + headZone &&
            player.position.x + pw > entity.position.x + ew * 0.1 &&
            player.position.x < entity.position.x + ew * 0.9) {
          this.applyHitToEntity(entity, entity._hp); // instant kill — _deathAction fires via _tickDeathSequence
          const bounceSpeed = Math.sqrt(2 * gravity * 2 * tileH);
          player.velocity.y = -bounceSpeed;
          player.onGround   = false;
          player._airborneFrames = 99;
          break; // one stomp per frame
        }
      }
    }

    // ── Collectible + powerup pickup ─────────────────────────────────────────
    if (player && !player._dead) {
      const pw = player.renderSize?.width  || 32;
      const ph = player.renderSize?.height || 32;
      for (const entity of this.entities) {
        if (entity._vanished || entity._dead) continue;
        const isCollectible = entity.role === 'collectible';
        const isPowerup = entity.role?.startsWith('powerup-');
        if (!isCollectible && !isPowerup) continue;
        const ew = entity.renderSize?.width  || 32;
        const eh = entity.renderSize?.height || 32;
        if (player.position.x < entity.position.x + ew &&
            player.position.x + pw > entity.position.x &&
            player.position.y < entity.position.y + eh &&
            player.position.y + ph > entity.position.y) {
          // Apply powerup effect immediately so the player feels it right away.
          if (isPowerup) {
            const kind = entity.role.slice('powerup-'.length);
            player._powerups[kind] = { timeLeft: kind === 'fire' ? 15 : kind === 'star' ? 10 : 8 };
            if (kind === 'star') player._invincibleTime = 10;
            this._runAction('add-score:100');
          }
          // Stop ambient idle sound and fire collect sound.
          this._stopEntityIdleSound(entity.id);
          this._playGameSound(entity.behavior?.sounds?.collect, { volume: 0.9 });
          // Look for a collect / hit animation to play before vanishing.
          const _collectAnim = entity.behavior?.collectAnim
            || entity.behavior?.hitAnim
            || this._getEntityAnimNames(entity).find(n =>
                /\b(collect|pickup|pick_up|hit|pop|taken|picked|fade|vanish)\b/i.test(n));
          if (_collectAnim) {
            // Enter death-sequence: animation plays, then entity vanishes + action fires.
            entity._dead          = true;
            entity.currentAnim    = _collectAnim;
            entity.animFrame      = 0;
            entity.animTime       = 0;
            const _adef           = this._getAnimDef(entity, _collectAnim);
            const _frames         = _adef?.frames?.length || 1;
            entity._vanishTimeLeft = _frames / Math.max(1, _adef?.fps || 8);
            entity._deathAction   = isPowerup ? null : (entity.events?.onCollect || 'add-score:100');
          } else {
            // No collect animation — vanish instantly (legacy behavior).
            entity._vanished = true;
            if (!isPowerup) this._runAction(entity.events?.onCollect || 'add-score:100');
          }
        }
      }
    }

    // ── Powerup timer decay ──────────────────────────────────────────────────
    if (player) {
      for (const key of Object.keys(player._powerups || {})) {
        player._powerups[key].timeLeft -= dt;
        if (player._powerups[key].timeLeft <= 0) {
          delete player._powerups[key];
        }
      }
    }

    // ── Top-Down Intelligence ────────────────────────────────────────────────
    if (!this.arcadeMode) {
      // Wave spawner — runs for any level with spawnWaves, runner waves, or VS/survival mode.
      if (this.level.spawnWaves?.length || this.level.runnerMode || this._isVampireMode() || this._isSurvivalMode()) {
        this._updateWaveSpawner(dt);
      }
      // Vampire Survivors auto-attack.
      if (this._isVampireMode() && player && !player._dead) {
        this._updateVampire(dt, player);
      }
      // XP gem collection.
      if (this._xpGems.length && player && !player._dead) {
        this._updateXpGems(dt, player);
      }
      // Projectile physics.
      if (this._projectiles.length) {
        this._updateProjectiles(dt);
      }
      // Twin-stick / mouse-aim manual fire for non-VS modes.
      if (!this._isVampireMode() && player && !player._dead) {
        this._updateAimFire(dt, player);
      }
    }

    // ── Endless runner mode ──────────────────────────────────────────────────
    if (this.level.runnerMode && player && !player._dead) {
      this._updateRunner(dt, player);
    }

    // ── Teleporter overlap / interact ────────────────────────────────────────
    if (player && !player._dead && !this.gameState.levelComplete && !this.gameState.gameOver) {
      const pw = player.renderSize?.width  || 32;
      const ph = player.renderSize?.height || 32;
      for (const entity of this.entities) {
        if (entity._vanished || entity.role !== 'teleporter') continue;
        const targetLevelId = entity.behavior?.targetLevelId;
        if (!targetLevelId) continue;
        // Cooldown prevents double-fire.
        if ((entity._teleportCooldown || 0) > 0) { entity._teleportCooldown -= dt; continue; }
        const ew = entity.renderSize?.width  || 32;
        const eh = entity.renderSize?.height || 32;
        const overlaps =
          player.position.x < entity.position.x + ew &&
          player.position.x + pw > entity.position.x &&
          player.position.y < entity.position.y + eh &&
          player.position.y + ph > entity.position.y;
        if (!overlaps) { entity._teleportActivated = false; continue; }
        const triggerMode = entity.behavior?.triggerMode || 'overlap';
        if (triggerMode === 'interact') {
          if (interactEdge) {
            entity._teleportCooldown = 1;
            this._runAction(`goto-level:${targetLevelId}`);
          }
        } else {
          // overlap — fires once per enter, not on every frame
          if (!entity._teleportActivated) {
            entity._teleportActivated = true;
            entity._teleportCooldown  = 1;
            this._runAction(`goto-level:${targetLevelId}`);
          }
        }
      }
    }

    // ── Win: all enemies defeated ────────────────────────────────────────────
    if (this.level.gameSettings?.winAllEnemies && !this.gameState.levelComplete && !this.gameState.gameOver) {
      const enemies = this.entities.filter(e => e.role === 'enemy');
      if (enemies.length > 0 && enemies.every(e => e._dead || e._vanished)) {
        this._runAction('next-level');
      }
    }

    // ── Win / lose: countdown timer ──────────────────────────────────────────
    if (this.gameState.timerRunning && !this.gameState.levelComplete && !this.gameState.gameOver) {
      this.gameState.timer = Math.max(0, this.gameState.timer - dt);
      if (this.gameState.timer <= 0) {
        this.gameState.timerRunning = false;
        if (this.level.gameSettings?.winOnTimerEnd) {
          this._runAction('next-level');
        } else {
          this._runAction(this.level.gameSettings?.timerEndAction || 'lose-life');
        }
      }
      this._emitState();
    }

    // Flash screen decay.
    if (this.gameState.flashScreen > 0) {
      this.gameState.flashScreen = Math.max(0, this.gameState.flashScreen - dt);
    }

    this.updateCamera();
  }

  // Shared physics step used by both player and enemy entities.
  // Handles bounds clamping, gravity, and axis-separated tile + segment collision.
  // Step-up: when a grounded entity is blocked horizontally, the engine tries
  // lifting it up to tileH/2 pixels so it can slide over gentle slopes instead
  // of stopping dead. Step-down keeps it glued to downward slopes while walking.
  _applyPhysics(entity, dt, gravity, isPlatformer, tileW, tileH, cols, rows) {
    const w = entity.renderSize?.width  || 32;
    const h = entity.renderSize?.height || 32;
    if (cols > 0 && rows > 0) {
      // Runner scrolls infinitely — don't clamp player X to level width.
      if (!this.level.runnerMode) {
        entity.position.x = Math.max(0, Math.min(entity.position.x, cols * tileW - w));
      }
      entity.position.y = Math.min(entity.position.y, rows * tileH - h); // clamp at floor only; top is open
    }
    // Apply gravity in the configured direction (default: down).
    if (isPlatformer) {
      const dir = this.level.gravityDir || 'down';
      if      (dir === 'up')    entity.velocity.y -= gravity * dt;
      else if (dir === 'left')  entity.velocity.x -= gravity * dt;
      else if (dir === 'right') entity.velocity.x += gravity * dt;
      else                      entity.velocity.y += gravity * dt; // down (default)
    }

    // ── X axis ────────────────────────────────────────────────────────────
    // segmentCollide already excludes one-way shapes, so no extra flag needed.
    const newX = entity.position.x + entity.velocity.x * dt;
    if (!this.collides(newX, entity.position.y, w, h, entity)) {
      entity.position.x = newX;
    } else if (isPlatformer && entity.onGround) {
      // Step-up: allow the entity to climb slopes without stopping.
      // Max rise is tied to horizontal pixels-per-frame so steep lines (>~50°)
      // still act as walls — preventing large frame-to-frame pops.
      const hMove = Math.abs(entity.velocity.x * dt);
      const maxStep = Math.max(1, Math.min(Math.ceil(tileH * 0.35), Math.ceil(hMove) + 1));
      let climbed = false;
      for (let step = 1; step <= maxStep; step++) {
        if (!this.collides(newX, entity.position.y - step, w, h, entity)) {
          entity.position.x = newX;
          entity.position.y -= step;
          entity.onGround  = true;
          entity._airborneFrames = 0;
          climbed = true;
          break;
        }
      }
      if (!climbed) {
        entity.velocity.x = 0;
        if (entity.role === 'enemy' && entity._patrolFlipCooldown <= 0) {
          entity._patrolDir *= -1;
          entity._patrolFlipCooldown = 0.25;
        }
      }
    } else {
      entity.velocity.x = 0;
      if (entity.role === 'enemy' && entity._patrolFlipCooldown <= 0) {
        entity._patrolDir *= -1;
        entity._patrolFlipCooldown = 0.25;
      }
    }

    // ── Y axis ────────────────────────────────────────────────────────────
    // Solid shapes: full AABB check in both directions.
    // One-way shapes: bottom-crossing test only (never fires from a lateral approach).
    //   - Moving up: one-way shapes ignored entirely (jump through).
    //   - Moving down / still: one-way only triggers if entity bottom crosses the line Y.
    const newY = entity.position.y + entity.velocity.y * dt;
    const solidBlockY = this.collides(entity.position.x, newY, w, h, entity);
    const oneWayBlockY = !solidBlockY && entity.velocity.y >= 0 &&
      this.oneWayBottomCross(entity.position.x, entity.position.y, h, newY, w, entity.onGround, Math.ceil(tileH * 0.35));
    if (!solidBlockY && !oneWayBlockY) {
      entity.position.y = newY;
      if (isPlatformer) {
        entity._airborneFrames = (entity._airborneFrames || 0) + 1;
        if (entity._airborneFrames > 3) entity.onGround = false;
      }
    } else {
      if (entity.velocity.y > 0 && isPlatformer) entity.onGround = true;
      entity._airborneFrames = 0;
      entity.velocity.y = 0;
    }
  }

  // Advance animation frames for entities that don't have their own update loop
  // (collectibles, powerups, NPCs, decorative objects, etc.).
  _tickEntityAnim(entity, dt) {
    if (!entity.currentAnim) {
      entity.currentAnim = entity.defaultAnimation || this._getEntityAnimNames(entity)[0] || null;
    }
    this._startEntityIdleSound(entity);
    const anim = this._getAnimDef(entity, entity.currentAnim);
    if (!anim?.frames?.length) return;
    entity.animTime = (entity.animTime || 0) + dt;
    const step = 1 / Math.max(1, anim.fps || 6);
    while (entity.animTime >= step) {
      entity.animTime -= step;
      entity.animFrame = anim.loop !== false
        ? (entity.animFrame + 1) % anim.frames.length
        : Math.min(entity.animFrame + 1, anim.frames.length - 1);
    }
  }

  updatePlayer(entity, dt, gravity, isPlatformer, tileW, tileH, cols, rows, attackEdge) {
    const speed = entity.stats?.speed || 120;
    const ix = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    const isDashing = this.input.dash;
    const effectiveSpeed = isDashing
      ? (entity.stats?.runSpeed ?? Math.round(speed * 1.8))
      : speed;
    entity.velocity.x = ix * effectiveSpeed;

    if (isPlatformer) {
      // ── Coyote time ─────────────────────────────────────────────────────
      // Start countdown the frame the player leaves ground (without jumping).
      if (entity._wasOnGround && !entity.onGround) {
        entity._coyoteTimer = 0.10;
      }
      entity._wasOnGround = entity.onGround;
      entity._coyoteTimer = Math.max(0, entity._coyoteTimer - dt);

      // ── Jump buffer ──────────────────────────────────────────────────────
      // Record jump input while airborne; fire it the moment we land.
      if (this.input.jump) {
        if (!entity.onGround) entity._jumpBuffer = 0.12;
      } else {
        entity._jumpBuffer = Math.max(0, entity._jumpBuffer - dt);
      }

      // Can jump when on ground OR within the coyote grace window.
      const groundProbe = this.collides(
        entity.position.x,
        entity.position.y + Math.max(2, Math.ceil(tileH * 0.08)),
        entity.renderSize?.width || 32,
        entity.renderSize?.height || 32,
        entity
      );
      if (groundProbe) {
        entity.onGround = true;
        entity._airborneFrames = 0;
      }
      const canJump   = entity.onGround || groundProbe || entity._coyoteTimer > 0;
      const wantsJump = this.input.jump || entity._jumpBuffer > 0;

      if (canJump && wantsJump) {
        const jumpTiles = entity.stats?.jumpHeight ?? 3;
        const jumpSpeed = Math.sqrt(2 * gravity * jumpTiles * tileH);
        const dir = this.level.gravityDir || 'down';
        if      (dir === 'up')    entity.velocity.y =  jumpSpeed;
        else if (dir === 'left')  entity.velocity.x =  jumpSpeed;
        else if (dir === 'right') entity.velocity.x = -jumpSpeed;
        else                      entity.velocity.y = -jumpSpeed;
        entity.onGround      = false;
        entity._airborneFrames = 99;
        entity._coyoteTimer  = 0;
        entity._jumpBuffer   = 0;
      }
    } else {
      const iy = (this.input.down ? 1 : 0) - (this.input.up ? 1 : 0);
      entity.velocity.y = iy * effectiveSpeed;
    }

    this._applyPhysics(entity, dt, gravity, isPlatformer, tileW, tileH, cols, rows);

    if (isPlatformer) {
      if (entity.velocity.x > 1) entity.facing = 'right';
      if (entity.velocity.x < -1) entity.facing = 'left';
    } else {
      // Top-down: full 8-directional facing; keep last direction while stationary.
      const _dir = this._getFacingDir(entity.velocity.x, entity.velocity.y);
      if (_dir) entity.facing = _dir;
    }
    if (entity._invincibleTime > 0) entity._invincibleTime -= dt;
    // Star powerup keeps invincibility refreshed (applyHit resets it to 0.4; star overrides)
    if (entity._powerups?.star) entity._invincibleTime = Math.max(entity._invincibleTime, 0.2);

    const attacks  = entity.behavior?.attacks;
    const animNames = this._getEntityAnimNames(entity);
    const moving   = Math.abs(entity.velocity.x) > 1 || (!isPlatformer && Math.abs(entity.velocity.y) > 1);
    const walkName = animNames.find(n => /\bwalk\b/i.test(n));
    const runName  = entity.behavior?.runAnim  || animNames.find(n => /\brun\b/i.test(n));
    const jumpName     = entity.behavior?.jumpAnim     || animNames.find(n => /\bjump\b|\bleap\b|\bair\b|\bfall\b/i.test(n));
    const jumpSideName = entity.behavior?.jumpSideAnim || animNames.find(n => /jump.?side|jump.?lateral|side.?jump/i.test(n));
    const moveName = (this.input.dash && runName) ? runName : (walkName || runName);
    // Directional variants (4-dir / 8-dir RPG/top-down).
    // Resolved from names like walk_left, walk_up_right, idle_down, run_north, etc.
    const dirWalk = this._resolveDirectionalAnim(animNames, 'walk', entity.facing, entity.velocity.x, entity.velocity.y);
    const dirRun  = this._resolveDirectionalAnim(animNames, 'run',  entity.facing, entity.velocity.x, entity.velocity.y);
    const dirIdle = this._resolveDirectionalAnim(animNames, 'idle', entity.facing);
    const effectiveMoveName = (this.input.dash && (dirRun || runName)) ? (dirRun || runName) : (dirWalk || moveName);

    // Tick active combo attack timer, then open/close the chain window.
    if (entity._comboState?.attackTimeLeft > 0) {
      entity._comboState.attackTimeLeft -= dt;
      if (entity._comboState.attackTimeLeft <= 0) {
        entity._comboState.attackTimeLeft = 0;
        if (entity._comboState.nextAttackId && entity._comboState.comboWindowDur > 0) {
          entity._comboState.windowLeft = entity._comboState.comboWindowDur;
        } else {
          entity._comboState = null;
        }
      }
    } else if (entity._comboState?.windowLeft > 0) {
      entity._comboState.windowLeft -= dt;
      if (entity._comboState.windowLeft <= 0) entity._comboState = null;
    }

    // New attack press — chain if inside combo window, else start first attack.
    if (attackEdge && attacks?.length) {
      const combo = entity._comboState;
      if (combo?.windowLeft > 0 && combo?.nextAttackId) {
        const next = attacks.find(a => a.id === combo.nextAttackId);
        if (next) this._triggerAttack(entity, next);
      } else if (!combo?.attackTimeLeft) {
        this._triggerAttack(entity, attacks[0]);
      }
    }

    // Animation priority: hit > active combo attack > (legacy hold-to-attack) > jump > move > idle.
    let desired = entity.defaultAnimation;
    if (entity._hitState?.timeLeft > 0) {
      entity._hitState.timeLeft -= dt;
      desired = entity._hitState.anim;
      if (entity._hitState.timeLeft <= 0) entity._hitState = { timeLeft: 0, anim: null };
    } else if (entity._comboState?.attackTimeLeft > 0) {
      const curAtk = attacks?.find(a => a.id === entity._comboState.attackId);
      desired = curAtk?.anim || desired;
    } else {
      // Legacy single-attack fallback (no attacks array defined).
      const legacyAtk = !attacks?.length
        ? (entity.behavior?.attackAnim || animNames.find(n => /attack|hit|slash|punch|combo/i.test(n)))
        : null;
      if (legacyAtk && this.input.attack) desired = legacyAtk;
      else if (isPlatformer && !entity.onGround) {
        const movingX = Math.abs(entity.velocity.x) > 1;
        desired = (movingX && jumpSideName) ? jumpSideName : (jumpName || desired);
      }
      else if (moving && effectiveMoveName) desired = effectiveMoveName;
      else desired = dirIdle || this._resolveIdleAnim(entity, dt);
    }
    if (!desired && animNames.length) desired = animNames[0];
    if (entity.currentAnim !== desired) {
      entity.currentAnim = desired;
      entity.animFrame = 0;
      entity.animTime = 0;
    }
    const anim = this._getAnimDef(entity, entity.currentAnim);
    if (anim?.frames?.length > 1) {
      entity.animTime += dt;
      const step = 1 / Math.max(1, anim.fps || 6);
      while (entity.animTime >= step) {
        entity.animTime -= step;
        entity.animFrame = anim.loop !== false
          ? (entity.animFrame + 1) % anim.frames.length
          : Math.min(entity.animFrame + 1, anim.frames.length - 1);
      }
    }
  }

  // Start a timed attack, resetting the per-swing hit set so the same enemy
  // can be damaged again on the next attack in the combo chain.
  _triggerAttack(entity, attackDef) {
    entity._comboState = {
      attackId: attackDef.id,
      attackTimeLeft: (attackDef.duration ?? 400) / 1000,
      windowLeft: 0,
      nextAttackId: attackDef.comboNext || null,
      comboWindowDur: (attackDef.comboWindow ?? 500) / 1000,
    };
    entity._attackHitSet = new Set();
    if (attackDef.anim) {
      entity.currentAnim = attackDef.anim;
      entity.animFrame = 0;
      entity.animTime = 0;
    }
  }

  // Returns the idle animation name to play, cycling through behavior.idles
  // with per-entry min/max timing. Falls back to defaultAnimation.
  _resolveIdleAnim(entity, dt) {
    const idles = entity.behavior?.idles;
    if (!idles?.length) return entity.defaultAnimation;
    let st = entity._idleState;
    if (!st) st = entity._idleState = { idx: 0, timer: 0 };
    st.timer -= dt;
    if (st.timer <= 0) {
      const nextIdx = idles.length > 1
        ? (st.idx + 1 + Math.floor(Math.random() * (idles.length - 1))) % idles.length
        : 0;
      st.idx = nextIdx;
      const idle = idles[nextIdx];
      const minT = idle.minTime ?? 2;
      const maxT = Math.max(minT + 0.1, idle.maxTime ?? 6);
      st.timer = minT + Math.random() * (maxT - minT);
    }
    return idles[st.idx]?.anim || entity.defaultAnimation;
  }

  // Advance the death animation (non-looping, holds last frame) and tick the
  // vanish countdown. Called every frame while entity._dead && !entity._vanished.
  _tickDeathSequence(entity, dt) {
    const anim = this._getAnimDef(entity, entity.currentAnim);
    if (anim?.frames?.length > 1) {
      entity.animTime += dt;
      const step = 1 / Math.max(1, anim.fps || 6);
      while (entity.animTime >= step) {
        entity.animTime -= step;
        entity.animFrame = Math.min(entity.animFrame + 1, anim.frames.length - 1);
      }
    }
    if (entity._vanishTimeLeft > 0) {
      entity._vanishTimeLeft -= dt;
      if (entity._vanishTimeLeft <= 0) {
        entity._vanished = true;
        if (entity._deathAction) {
          this._runAction(entity._deathAction);
          entity._deathAction = null;
        }
        // Spawn XP gem when an enemy dies in VS / survival modes.
        if (entity.role === 'enemy' && (this._isVampireMode() || this._isSurvivalMode())) {
          this._spawnXpGem(entity.position.x, entity.position.y);
        }
      }
    }
  }

  // Generalized hit application — works for any entity (player or enemy).
  // Damage formula: incoming power is reduced by the target's flat defense stat,
  // then a ±20% random variance is applied. Result is always at least 1.
  applyHitToEntity(entity, power = 10) {
    if (!entity || entity._dead || entity._invincibleTime > 0) return;
    const defense  = entity.stats?.defense || 0;
    const reduced  = Math.max(0, power - defense);
    // If defense fully absorbs the hit, deal 0 — no chip damage on tanks.
    // Otherwise apply ±20% variance so identical attacks don't feel robotic.
    const variance = reduced > 0 ? reduced * 0.2 * (Math.random() * 2 - 1) : 0;
    const actual   = Math.max(0, Math.round(reduced + variance));
    entity._hp = (entity._hp ?? 100) - actual;
    entity._invincibleTime = 0.4;
    if (entity._hp <= 0) {
      entity._hp = 0;
      entity._dead = true;
      const deathAnim = entity.behavior?.deathAnim
        || this._getEntityAnimNames(entity).find(n => /\bdeath\b|\bdie\b|\bdead\b/i.test(n));
      if (deathAnim) {
        entity.currentAnim = deathAnim;
        entity.animFrame = 0;
        entity.animTime = 0;
      }
      const vanishMs = entity.behavior?.vanishDelay;
      entity._vanishTimeLeft = (vanishMs != null && vanishMs > 0) ? vanishMs / 1000 : 0;
      if (entity.role === 'enemy') entity._aiState = 'dead';
      if (entity.role === 'playerMain') {
        entity._deathAction = entity.events?.onDeath || 'lose-life';
        // Guarantee a window for the death animation before firing the action.
        if (entity._vanishTimeLeft <= 0) entity._vanishTimeLeft = 0.8;
        this.gameState.flashScreen = 0.3;
      } else {
        // Enemies/collectibles: queue their onDeath event and ensure a vanish delay.
        entity._deathAction = entity.events?.onDeath || null;
        if (entity._vanishTimeLeft <= 0) entity._vanishTimeLeft = 0.5;
      }
      return;
    }
    const animNames = this._getEntityAnimNames(entity);
    const threshold  = entity.behavior?.hitThreshold ?? 30;
    const hitName    = entity.behavior?.hitAnim      || animNames.find(n => /\bhurt\b|\bpain\b|\bflinch\b|\bdamage\b/i.test(n));
    const heavyName  = entity.behavior?.heavyHitAnim || animNames.find(n => /\bheavy\b|\bstagger\b|\bknockback\b|\bko\b/i.test(n));
    const anim = (power >= threshold && heavyName) ? heavyName : hitName;
    if (anim) {
      const dur = (entity.behavior?.hitDuration ?? 500) / 1000;
      entity._hitState = { timeLeft: dur, anim };
      entity.currentAnim = anim;
      entity.animFrame = 0;
      entity.animTime = 0;
    }
    if (entity.role === 'enemy') entity._aiState = 'hurt';
  }

  // Enemy AI — patrol / chase / attack state machine.
  updateEnemyAI(entity, player, dt, tileW, tileH) {
    const speed          = entity.stats?.speed || 80;
    const detectionRange = (entity.behavior?.detectionRange ?? 8) * tileW;
    const attackRange    =  entity.behavior?.attackRange    ?? 48;
    const patrolRange    = (entity.behavior?.patrolRange    ?? 3) * tileW;
    const { isPlatformer } = this._getEffectivePhysics();

    if (entity._invincibleTime    > 0) entity._invincibleTime    -= dt;
    if (entity._attackCooldown   > 0) entity._attackCooldown   -= dt;
    if (entity._patrolFlipCooldown > 0) entity._patrolFlipCooldown -= dt;

    // Locked in hurt animation — wait until it expires, then return to patrol.
    if (entity._hitState?.timeLeft > 0) {
      entity._hitState.timeLeft -= dt;
      if (entity._hitState.timeLeft <= 0) {
        entity._hitState = { timeLeft: 0, anim: null };
        entity._aiState = 'patrol';
      }
      entity.velocity.x = 0;
      return;
    }
    if (entity._dead) { entity.velocity.x = 0; return; }

    const playerCx = player.position.x + (player.renderSize?.width  || 32) / 2;
    const playerCy = player.position.y + (player.renderSize?.height || 32) / 2;
    const enemyCx  = entity.position.x  + (entity.renderSize?.width  || 32) / 2;
    const enemyCy  = entity.position.y  + (entity.renderSize?.height || 32) / 2;
    const dx   = playerCx - enemyCx;
    const dy   = playerCy - enemyCy;
    const dist = Math.abs(dx);

    // State transitions: attack range beats detection range beats patrol.
    if (dist <= attackRange) {
      entity._aiState = 'attack';
    } else if (dist <= detectionRange) {
      entity._aiState = 'chase';
    } else if (entity._aiState !== 'patrol') {
      entity._aiState = 'patrol';
    }

    if (entity._aiState === 'attack') {
      entity.velocity.x = 0;
      // Top-down: also consider vertical distance for attack facing
      const attackDir = isPlatformer
        ? (dx >= 0 ? 'right' : 'left')
        : (this._getFacingDir(dx, dy) || (dx >= 0 ? 'right' : 'left'));
      entity.facing = attackDir;
    } else if (entity._aiState === 'chase') {
      entity.velocity.x = Math.sign(dx) * speed;
      const chaseDir = isPlatformer
        ? (dx >= 0 ? 'right' : 'left')
        : (this._getFacingDir(dx, dy) || (dx >= 0 ? 'right' : 'left'));
      entity.facing = chaseDir;
    } else {
      // Patrol: walk back and forth within patrolRange tiles of spawn X.
      const distFromSpawn = entity.position.x - entity._spawnX;
      let dirFlipped = false;
      if (distFromSpawn >  patrolRange) { entity._patrolDir = -1; dirFlipped = true; }
      if (distFromSpawn < -patrolRange) { entity._patrolDir =  1; dirFlipped = true; }
      // Edge detection — only in platformer mode when the entity is on the ground,
      // and only when the distance check didn't already flip the direction (prevents
      // the two checks fighting each other and causing rapid oscillation).
      if (!dirFlipped && isPlatformer && entity.onGround && entity._patrolFlipCooldown <= 0) {
        const w = entity.renderSize?.width  || 32;
        const h = entity.renderSize?.height || 32;
        const footX = entity._patrolDir > 0 ? entity.position.x + w : entity.position.x - 2;
        if (!this.tileCollide(footX, entity.position.y + h, 2, tileH)) {
          entity._patrolDir *= -1;
          entity._patrolFlipCooldown = 0.25;
        }
      }
      entity.velocity.x = entity._patrolDir * speed * 0.5;
      entity.facing = entity._patrolDir > 0 ? 'right' : 'left';
    }
  }

  // Enemy animation selection driven by AI state.
  updateEnemyAnimation(entity, dt) {
    const animNames    = this._getEntityAnimNames(entity);
    if (!animNames.length) return;
    const { isPlatformer } = this._getEffectivePhysics();
    const walkName     = entity.behavior?.runAnim    || animNames.find(n => /\bwalk\b|\brun\b/i.test(n));
    const attackName   = entity.behavior?.attacks?.[0]?.anim
      || entity.behavior?.attackAnim
      || animNames.find(n => /attack|slash|punch|combo/i.test(n));
    const jumpName     = entity.behavior?.jumpAnim     || animNames.find(n => /\bjump\b|\bleap\b|\bair\b|\bfall\b/i.test(n));
    const jumpSideName = entity.behavior?.jumpSideAnim || animNames.find(n => /jump.?side|jump.?lateral|side.?jump/i.test(n));
    const idleName     = entity.defaultAnimation || animNames[0];
    // Directional variants for top-down enemies
    const dirWalk = this._resolveDirectionalAnim(animNames, 'walk', entity.facing, entity.velocity.x, entity.velocity.y)
                 || this._resolveDirectionalAnim(animNames, 'run',  entity.facing, entity.velocity.x, entity.velocity.y);
    const dirIdle = this._resolveDirectionalAnim(animNames, 'idle', entity.facing);
    const isMoving = Math.abs(entity.velocity.x) > 1 || (!isPlatformer && Math.abs(entity.velocity.y) > 1);
    let desired = dirIdle || idleName;
    if (entity._hitState?.timeLeft > 0) {
      desired = entity._hitState.anim || idleName;
    } else if (entity._aiState === 'attack' && attackName) {
      desired = attackName;
    } else if (isPlatformer && !entity.onGround) {
      const movingX = Math.abs(entity.velocity.x) > 1;
      desired = (movingX && jumpSideName) ? jumpSideName : (jumpName || idleName);
    } else if (isMoving && (dirWalk || walkName)) {
      desired = dirWalk || walkName;
    } else if (dirIdle) {
      desired = dirIdle;
    }
    if (entity.currentAnim !== desired) {
      entity.currentAnim = desired;
      entity.animFrame = 0;
      entity.animTime = 0;
    }
    const anim = this._getAnimDef(entity, entity.currentAnim);
    if (anim?.frames?.length > 1) {
      entity.animTime += dt;
      const step = 1 / Math.max(1, anim.fps || 6);
      while (entity.animTime >= step) {
        entity.animTime -= step;
        entity.animFrame = anim.loop !== false
          ? (entity.animFrame + 1) % anim.frames.length
          : Math.min(entity.animFrame + 1, anim.frames.length - 1);
      }
    }
  }

  // Bidirectional combat: player attack damages enemies; enemies contact-damage player.
  checkCombat(player, dt) {
    const pw = player.renderSize?.width  || 32;
    const ph = player.renderSize?.height || 32;
    for (const enemy of this.entities) {
      if (enemy.role !== 'enemy' || enemy._dead) continue;
      const ew = enemy.renderSize?.width  || 32;
      const eh = enemy.renderSize?.height || 32;

      // AABB overlap between player and this enemy.
      const overlapX = player.position.x < enemy.position.x + ew && player.position.x + pw > enemy.position.x;
      const overlapY = player.position.y < enemy.position.y + eh && player.position.y + ph > enemy.position.y;

      // Player attack: active combo swing OR legacy held-button attack.
      const attacks = player.behavior?.attacks;
      const comboActive = player._comboState?.attackTimeLeft > 0;
      const legacyActive = !attacks?.length && this.input.attack;
      if (comboActive || legacyActive) {
        const curAtk = attacks?.find(a => a.id === player._comboState?.attackId);
        const reach  = curAtk?.reach ?? Math.round(pw * 1.8);
        const pCx    = player.position.x + pw / 2;
        const eCx    = enemy.position.x  + ew / 2;
        const inReach = player.facing === 'right'
          ? eCx > pCx && eCx < pCx + reach
          : eCx < pCx && eCx > pCx - reach;
        const inYRange = Math.abs((player.position.y + ph / 2) - (enemy.position.y + eh / 2)) < (ph + eh) / 2;
        if (inReach && inYRange) {
          if (!player._attackHitSet) player._attackHitSet = new Set();
          const key = enemy.id || enemy;
          if (!player._attackHitSet.has(key)) {
            player._attackHitSet.add(key);
            this.applyHitToEntity(enemy, curAtk?.damage ?? 25);
          }
        }
      } else if (!comboActive && !legacyActive) {
        if (!attacks?.length) player._attackHitSet = null;
      }

      // Star powerup — player kills any enemy on contact.
      if (overlapX && overlapY && player._powerups?.star) {
        this.applyHitToEntity(enemy, 999);
        this._runAction('add-score:200');
        continue;
      }

      // Enemy contact damage — only while in attack state and cooldown is ready.
      if (overlapX && overlapY && enemy._aiState === 'attack' && enemy._attackCooldown <= 0) {
        const enemyDmg = enemy.behavior?.attacks?.[0]?.damage ?? enemy.stats?.damage ?? 10;
        this.applyHitToEntity(player, enemyDmg);
        enemy._attackCooldown = (enemy.behavior?.attackCooldown ?? 1200) / 1000;
      }
    }
  }

  // True if the AABB (x, y, w, h) overlaps any non-zero tile or hits the
  // level bounds. Prefers a layer with kind === 'collision'; falls back to
  // the first layer so single-layer maps work without extra configuration.
  tileCollide(x, y, w, h) {
    const tm = this.level.tileMap || {};
    const cols = tm.cols || 0;
    const rows = tm.rows || 0;
    const tileW = tm.tileWidth || 32;
    const tileH = tm.tileHeight || 32;
    const layer = (tm.layers || []).find(l => l.kind === 'collision') || (tm.layers || [])[0];
    if (!layer) return false;

    if (x < 0) return true;                                          // left wall
    if (!this.level.runnerMode && x + w > cols * tileW) return true; // right wall (open in runner)
    if (y + h > rows * tileH) return true;             // floor is hard
    // Top is open — entities can jump/move past y=0; camera stays clamped

    const c0 = Math.max(0, Math.floor(x / tileW));
    const c1 = Math.min(cols - 1, Math.floor((x + w - 1) / tileW));
    const r0v = Math.max(0, Math.floor(y / tileH));
    const r1v = Math.min(rows - 1, Math.floor((y + h - 1) / tileH));
    for (let r = r0v; r <= r1v; r++) {
      const dr = (rows - 1) - r; // visual row → data row (floor-up)
      for (let c = c0; c <= c1; c++) {
        if ((layer.data[dr * cols + c] | 0) > 0) return true;
      }
    }
    return false;
  }

  updateCamera() {
    const player = this._findPlayer();
    if (!player) return;
    const tm = this.level.tileMap || {};
    const levelW = (tm.cols || 0) * (tm.tileWidth || 32);
    const levelH = (tm.rows || 0) * (tm.tileHeight || 32);
    // Use world-space view dimensions (canvas px / renderScale) for camera bounds.
    const rs = this._renderScale || 1;
    const viewW = this.canvas.width  / rs;
    const viewH = this.canvas.height / rs;
    const axis = this.level.cameraAxis || 'both';

    // Endless runner: camera advances automatically; player X is locked to a fixed screen offset.
    if (this.level.runnerMode) {
      // camera already advanced in _updateRunner; just snap player X to fixed screen position.
      player.position.x = this.cameraX + Math.round(viewW * 0.18);
      const targetY = player.position.y + (player.renderSize?.height || 32) / 2 - viewH / 2;
      this.cameraY = Math.max(0, Math.min(targetY, Math.max(0, levelH - viewH)));
      return;
    }

    const targetX = player.position.x + (player.renderSize?.width  || 32) / 2 - viewW / 2;
    const targetY = player.position.y + (player.renderSize?.height || 32) / 2 - viewH / 2;
    if (axis === 'fixed') {
      // Camera never moves — stays at origin (single-screen games).
      this.cameraX = 0;
      this.cameraY = 0;
    } else if (axis === 'x') {
      this.cameraX = Math.max(0, Math.min(targetX, Math.max(0, levelW - viewW)));
      this.cameraY = 0;
    } else if (axis === 'y') {
      this.cameraX = 0;
      this.cameraY = Math.max(0, Math.min(targetY, Math.max(0, levelH - viewH)));
    } else {
      // Both axes (default).
      this.cameraX = Math.max(0, Math.min(targetX, Math.max(0, levelW - viewW)));
      this.cameraY = Math.max(0, Math.min(targetY, Math.max(0, levelH - viewH)));
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────
  draw() {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Backgrounds use the same world-pixel coordinate space as entities/colliders,
    // so they always align with what the editor canvas shows.
    this.drawBackgrounds();

    // World content (tiles, entities, projectiles). _renderScale is always 1 so
    // the block below is a no-op; kept for forward-compatibility.
    const _needsScale = this._renderScale !== 1 || this._renderOffsetX !== 0 || this._renderOffsetY !== 0;
    if (_needsScale) {
      ctx.save();
      ctx.translate(this._renderOffsetX, this._renderOffsetY);
      ctx.scale(this._renderScale, this._renderScale);
    }

    this.drawTilemap();
    // Strategy, card, and racing modes own their full draw order; all others use the standard pipeline.
    const _skipEntities = this.arcadeMode === 'strategy.tower-defense' ||
                          this.arcadeMode === 'strategy.match-3' ||
                          this.arcadeMode === 'card.blackjack' ||
                          this.arcadeMode === 'card.solitaire' ||
                          this.arcadeMode === 'racing.top-down' ||
                          this.arcadeMode === 'racing.endless' ||
                          this.arcadeMode === 'rhythm.lane-tap' ||
                          this.arcadeMode === 'fighting.brawler';
    if (!_skipEntities) {
      this.drawEntities();
      if (!_needsScale) this.drawOcclusion(); // occlusion clip paths need unscaled space
    }
    if (this.arcadeMode) this._drawArcade();
    if (!this.arcadeMode) { this._drawXpGems(); this._drawProjectiles(); }
    if (this.showColliders) this.drawColliders();
    if (this.mpAdapter?.remotePlayers.size) this._drawRemotePlayers();

    if (_needsScale) ctx.restore();

    // Flash screen overlay — fades out over flashScreen seconds.
    if (this.gameState.flashScreen > 0) {
      const alpha = Math.min(0.55, this.gameState.flashScreen * 1.5);
      ctx.fillStyle = `rgba(255, 60, 60, ${alpha})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  // Redraws backgrounds + tilemap clipped to each occlusion polygon so those
  // regions appear in front of entities — giving the illusion the player is
  // passing behind foreground objects painted into the background image.
  drawOcclusion() {
    const shapes = this.level.occlusionShapes || [];
    if (!shapes.length) return;
    const ctx = this.ctx;
    for (const shape of shapes) {
      const pts = shape.points || [];
      if (pts.length < 3) continue;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x - this.cameraX, pts[0].y - this.cameraY);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x - this.cameraX, pts[i].y - this.cameraY);
      }
      ctx.closePath();
      ctx.clip();
      this.drawBackgrounds();
      this.drawTilemap();
      ctx.restore();
    }
  }

  drawBackgrounds() {
    const ctx = this.ctx;
    // Coordinates match the editor's BackgroundLayers CSS preview 1:1.
    // offset.x/y are world-pixels (same coordinate space as entities and colliders).
    const viewW = this.canvas.width;
    const viewH = this.canvas.height;
    const portrait = typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches;
    for (const layer of this.level.backgrounds || []) {
      const usePortrait = portrait && layer.assetIdPortrait;
      const effectiveId = usePortrait ? layer.assetIdPortrait : layer.assetId;
      const asset = (this.assets.backgrounds || []).find(a => a.id === effectiveId);
      const img = asset && this.images.get(asset.id);
      if (!img) continue;
      // behavior 'world' (default): anchored to world-space — background always aligns
      // with colliders/entities exactly as the editor shows. 'parallax': uses parallax
      // x/y values for depth drift effect (far backgrounds).
      const isWorld = (layer.behavior || 'world') !== 'parallax';
      const px = isWorld ? 1 : (layer.parallax?.x ?? 1);
      const py = isWorld ? 1 : (layer.parallax?.y ?? 1);
      const sx = (layer.scroll?.x || 0) * this.time;
      const sy = (layer.scroll?.y || 0) * this.time;
      const ox = layer.offset?.x || 0;
      const oy = layer.offset?.y || 0;
      const scale = layer.scale || 1;
      const opacity = layer.opacity ?? 1;
      const repX = layer.repeat?.x !== false;
      const repY = layer.repeat?.y === true;
      const iw = img.width  * scale;
      const ih = img.height * scale;
      let offX = ox - this.cameraX * px + sx;
      let offY = oy - this.cameraY * py + sy;
      if (repX) { offX = offX % iw; if (offX > 0) offX -= iw; }
      if (repY) { offY = offY % ih; if (offY > 0) offY -= ih; }
      const cols = repX ? Math.ceil((viewW - offX) / iw) + 1 : 1;
      const rows = repY ? Math.ceil((viewH - offY) / ih) + 1 : 1;
      ctx.save();
      ctx.globalAlpha = opacity;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.drawImage(img, offX + c * iw, offY + r * ih, iw, ih);
        }
      }
      ctx.restore();
    }
  }

  drawTilemap() {
    const tm = this.level.tileMap || {};
    const ts = resolveTilesetView(this.assets, tm.tilesetAssetId);
    if (!ts) return;
    const img = this.images.get(ts.id);
    if (!img) return;
    const layer = (tm.layers || [])[0];
    if (!layer) return;
    const cols = tm.cols || 0;
    const rows = tm.rows || 0;
    const tileW = tm.tileWidth || 32;
    const tileH = tm.tileHeight || 32;
    const tsCols = Math.max(1, ts.cols || 1);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(-this.cameraX, -this.cameraY);
    for (let i = 0; i < cols * rows; i++) {
      const v = layer.data[i] | 0;
      if (v <= 0) continue;
      const tsIdx = v - 1;
      const { x: sx, y: sy } = cellOrigin(ts, tsIdx % tsCols, Math.floor(tsIdx / tsCols));
      const dx = (i % cols) * tileW;
      const dy = ((rows - 1) - Math.floor(i / cols)) * tileH;
      ctx.drawImage(img, sx, sy, ts.tileWidth, ts.tileHeight, dx, dy, tileW, tileH);
    }
    ctx.restore();
  }

  drawColliders() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(-this.cameraX, -this.cameraY);

    // Tile collision layer — orange fill + stroke per solid cell.
    const tm = this.level.tileMap || {};
    const cols = tm.cols || 0;
    const rows = tm.rows || 0;
    const tileW = tm.tileWidth || 32;
    const tileH = tm.tileHeight || 32;
    const layer = (tm.layers || []).find(l => l.kind === 'collision') || (tm.layers || [])[0];
    if (layer) {
      ctx.fillStyle   = 'rgba(255,165,0,0.25)';
      ctx.strokeStyle = 'rgba(255,165,0,0.85)';
      ctx.lineWidth = 1;
      for (let i = 0; i < cols * rows; i++) {
        if ((layer.data[i] | 0) <= 0) continue;
        const dx = (i % cols) * tileW;
        const dy = ((rows - 1) - Math.floor(i / cols)) * tileH;
        ctx.fillRect(dx, dy, tileW, tileH);
        ctx.strokeRect(dx + 0.5, dy + 0.5, tileW - 1, tileH - 1);
      }
    }

    // Occlusion masks — purple fill to show foreground regions.
    for (const shape of (this.level.occlusionShapes || [])) {
      const pts = shape.points || [];
      if (pts.length < 3) continue;
      ctx.fillStyle   = 'rgba(180,0,255,0.15)';
      ctx.strokeStyle = 'rgba(180,0,255,0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Line-based collision shapes — orange (solid) or green (one-way).
    ctx.setLineDash([5, 3]);
    ctx.lineWidth = 2;
    for (const shape of (this.level.colliderShapes || [])) {
      const pts = shape.points || [];
      if (pts.length < 2) continue;
      const c = shape.oneWay ? 'rgba(80,220,80,0.9)' : 'rgba(255,165,0,0.9)';
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (shape.closed) ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = c;
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Draw tick marks on one-way shapes to show the solid side (upward).
      if (shape.oneWay) {
        ctx.setLineDash([]);
        ctx.lineWidth = 1.5;
        for (let i = 0; i < pts.length - 1; i++) {
          const ax = pts[i].x, ay = pts[i].y;
          const bx = pts[i+1].x, by = pts[i+1].y;
          const len = Math.hypot(bx-ax, by-ay);
          if (len < 4) continue;
          const dx = (bx-ax)/len, dy = (by-ay)/len;
          const nx = dy < 0 ? dy : -dy;
          const ny = dy < 0 ? -dx : dx;
          const count = Math.max(1, Math.floor(len / 24));
          for (let t = 0; t <= count; t++) {
            const f = count === 0 ? 0.5 : t / count;
            const mx = ax + dx*len*f, my = ay + dy*len*f;
            ctx.beginPath();
            ctx.moveTo(mx, my);
            ctx.lineTo(mx + nx*7, my + ny*7);
            ctx.stroke();
          }
        }
        ctx.setLineDash([5, 3]);
        ctx.lineWidth = 2;
      }
    }
    ctx.setLineDash([]);

    // Entity hitboxes — green for player, red for enemies.
    ctx.lineWidth = 1;
    for (const entity of this.entities) {
      if (entity._vanished) continue;
      const ew = entity.renderSize?.width  || 32;
      const eh = entity.renderSize?.height || 32;
      const ex = entity.position.x;
      const ey = entity.position.y;
      const isPlayer = entity === this._findPlayer();
      ctx.fillStyle   = isPlayer ? 'rgba(0,255,160,0.12)' : 'rgba(255,60,60,0.12)';
      ctx.strokeStyle = isPlayer ? 'rgba(0,255,160,0.9)'  : 'rgba(255,60,60,0.9)';
      ctx.fillRect(ex, ey, ew, eh);
      ctx.strokeRect(ex + 0.5, ey + 0.5, ew - 1, eh - 1);
    }

    ctx.restore();
  }

  drawEntities() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(-this.cameraX, -this.cameraY);
    for (const entity of this.entities) {
      if (entity._vanished) continue;
      // Teleporters without a sprite are invisible in-game; they only show up
      // in the editor canvas so the designer can click and configure them.
      if (entity.role === 'teleporter' && !this._getSheetForAnim(entity, entity.currentAnim)) continue;

      // Star powerup: rainbow flicker effect (rapid hue shift overlay).
      const hasStar = entity === this._findPlayer() && entity._powerups?.star;
      // Grow powerup: scale entity 1.5x (visual only, hitbox unchanged).
      const hasGrow = entity === this._findPlayer() && entity._powerups?.grow;

      if (hasGrow) {
        ctx.save();
        const cx = entity.position.x + (entity.renderSize?.width || 32) / 2;
        const by = entity.position.y + (entity.renderSize?.height || 32);
        ctx.translate(cx, by);
        ctx.scale(1.5, 1.5);
        ctx.translate(-cx, -by);
        this.drawEntity(entity);
        ctx.restore();
      } else {
        this.drawEntity(entity);
      }

      if (hasStar) {
        // Translucent rainbow shimmer over the player sprite.
        const hue = Math.round(this.time * 360) % 360;
        const pw  = (entity.renderSize?.width  || 32) * (hasGrow ? 1.5 : 1);
        const ph  = (entity.renderSize?.height || 32) * (hasGrow ? 1.5 : 1);
        const ox  = hasGrow ? entity.position.x - pw * 0.25 : entity.position.x;
        const oy  = hasGrow ? entity.position.y - ph * 0.5  : entity.position.y;
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle   = `hsl(${hue},100%,60%)`;
        ctx.fillRect(ox, oy, pw, ph);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  drawEntity(entity) {
    const ctx = this.ctx;
    const drawPlaceholder = () => {
      const w = entity.renderSize?.width || 32;
      const h = entity.renderSize?.height || 32;
      const roleColors = {
        playerMain: '#00FF88', player: '#00FF88', platform: '#888888', enemy: '#FF4444',
        collectible: '#FFD700', trigger: 'rgba(0,150,255,0.35)',
        spawnPoint: '#FF00FF', teleporter: 'rgba(200,0,255,0.45)',
        tower: '#4488FF', projectile: '#FF8800', powerup: '#00FFFF',
        goal: '#FFFF00', npc: '#FF88CC', wall: '#AAAAAA',
        particleEmitter: '#00FFFF', soundEmitter: '#4499FF',
      };
      const color = roleColors[entity.role] || '#AAAAAA';
      const x = entity.position.x;
      const y = entity.position.y;
      ctx.save();
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
      if (entity.role) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.min(10, Math.floor(h * 0.4))}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(entity.role.slice(0, 3).toUpperCase(), x + w / 2, y + h / 2);
      }
      ctx.restore();
    };
    const sheet = this._getSheetForAnim(entity, entity.currentAnim);
    if (!sheet) {
      // Static image (e.g. particleEmitter with particleImageUrl, no sprite sheet)
      if (entity.particleImageUrl) {
        const img = this.images.get(entity.particleImageUrl);
        if (img) {
          const w = entity.renderSize?.width  || img.naturalWidth  || 32;
          const h = entity.renderSize?.height || img.naturalHeight || 32;
          ctx.drawImage(img, entity.position.x, entity.position.y, w, h);
          return;
        }
      }
      drawPlaceholder();
      return;
    }
    const img = this.images.get(sheet.id);
    if (!img) { drawPlaceholder(); return; }
    const anim = this._getAnimDef(entity, entity.currentAnim);
    const frames = anim?.frames || [];
    if (!frames.length) { drawPlaceholder(); return; }
    const f = sheet.frame;
    const cols = Math.max(1, f.cols || 1);
    const idx = frames[entity.animFrame] ?? 0;
    const cx = idx % cols;
    const cy = Math.floor(idx / cols);
    // Reuse cellOrigin by feeding it a tileset-shaped view.
    const view = {
      tileWidth: f.width, tileHeight: f.height,
      cols: f.cols, rows: f.rows,
      offsetLeft: f.offsetLeft ?? f.offsetX ?? 0,
      offsetTop:  f.offsetTop  ?? f.offsetY ?? 0,
      gapX: f.gapX, gapY: f.gapY,
    };
    const { x: sx, y: sy } = cellOrigin(view, cx, cy);
    const fw = f.width;
    const fh = f.height;
    // Lock display height to renderSize.height so all animations appear at
    // the same character height. Width scales proportionally — wide animations
    // (run, attack) may be wider than the hitbox; that is intentional.
    // Bottom-anchored: py = entity.position.y, so sprite bottom = hitbox
    // bottom = ground tile surface. No floating gap.
    const rw = entity.renderSize?.width || fw;
    const hitboxH = entity.renderSize?.height || fh;
    const slot = (entity.animations || []).find(a => a.name === entity.currentAnim);
    // Per-slot renderH / spriteOffsetY override.
    const rh = (slot?.renderH != null ? slot.renderH : hitboxH) || fh;
    const dh = rh;
    const dw = Math.round(fw * (rh / fh));
    const cox = Math.round((rw - dw) / 2);
    const spriteOffY = (slot?.spriteOffsetY != null ? slot.spriteOffsetY : entity.spriteOffsetY) || 0;
    // Bottom-anchor: sprite bottom always aligns with hitbox bottom regardless
    // of the override height. py shifts down by (hitboxH - rh) so the visual
    // base stays on the floor when the sprite is shorter than the hitbox.
    const nativeDir = slot?.nativeDir || 'right';
    // Directional sprite sets (walk_left + walk_right exist) already have the correct
    // frame for each direction — never auto-flip them.
    const _allAnims = this._getEntityAnimNames(entity);
    const _hasLeftAnim  = _allAnims.some(n => /[_\-.]l(eft)?$/i.test(n));
    const _hasRightAnim = _allAnims.some(n => /[_\-.]r(ight)?$/i.test(n));
    const _isGoingLeft  = entity.facing === 'left' || (entity.facing || '').endsWith('-left');
    const shouldFlip = (_hasLeftAnim && _hasRightAnim)
      ? false
      : (nativeDir === 'right' ? _isGoingLeft : !_isGoingLeft);
    const px = entity.position.x + cox;
    const py = entity.position.y + hitboxH - dh - spriteOffY;
    if (shouldFlip) {
      ctx.save();
      ctx.translate(px + dw, py);
      ctx.scale(-1, 1);
      ctx.drawImage(img, sx, sy, fw, fh, 0, 0, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(img, sx, sy, fw, fh, px, py, dw, dh);
    }
  }

  // ── Endless Runner ─────────────────────────────────────────────────────────
  // Camera scrolls rightward at increasing speed. Player X is pinned to a fixed
  // screen column (18% from left). Enemies with `runnerObstacle: true` are
  // recycled back to the right edge when they exit the left of the screen.
  _updateRunner(dt, player) {
    if (!this._runner) {
      this._runner = { speed: this.level.runnerBaseSpeed || 240, time: 0, started: false };
    }
    const r = this._runner;

    // Idle phase — wait for the player to press a key before the run begins.
    // Lane mode excludes jump (space) as a start trigger so the jump physics
    // don't fire mid-frame and corrupt the ground-anchor capture.
    if (!r.started) {
      const isLaneMode = (this.level.runnerLanes || 1) > 1;
      const startPressed = isLaneMode
        ? (this.input.right || this.input.up || this.input.down)
        : (this.input.jump  || this.input.right || this.input.up);
      if (startPressed) {
        r.started = true;
        r._prevLaneUp   = this.input.up;
        r._prevLaneDown = this.input.down;
      } else {
        player.velocity.x = 0;
        return; // keep camera fixed, skip everything below
      }
    }

    r.time += dt;
    // Speed ramp — configurable via speedRampRate (% per interval) and speedRampInterval (s)
    {
      const base     = this.level.runnerBaseSpeed   || 240;
      const rate     = (this.level.speedRampRate    ?? 1) / 100;  // default 1%
      const interval = this.level.speedRampInterval ?? 10;        // default 10s
      const maxSpd   = this.level.speedMax          || 0;
      const steps    = interval > 0 ? Math.floor(r.time / interval) : 0;
      const ramped   = base * (1 + rate * steps);
      r.speed = maxSpd > 0 ? Math.min(ramped, maxSpd) : ramped;
    }

    // Distance score — accumulate fractional points, emit on each whole point
    r._scoreFrac = (r._scoreFrac || 0) + r.speed * dt / 40;
    const pts = Math.floor(r._scoreFrac);
    if (pts > 0) {
      r._scoreFrac -= pts;
      this.gameState.score += pts;
      this._emitState();
    }

    // Advance camera rightward
    this.cameraX += r.speed * dt;

    // Win by distance — cameraX / tileW = tiles traveled; winDistance=0 means infinite
    const _tileW = this.level.tileMap?.tileWidth || 32;
    const winDist = this.level.gameSettings?.winDistance || 0;
    if (winDist > 0 && this.cameraX / _tileW >= winDist) {
      this._runAction('next-level');
      return;
    }

    const viewW = this.canvas.width / (this._renderScale || 1);
    const lanes = this.level.runnerLanes || 1;

    // Recycle obstacle entities that slide off the left edge.
    // In lane mode, re-assign each enemy to its configured lane (or a random one).
    const laneYsCache = lanes > 1 ? this._getRunnerLaneYs(lanes) : null;
    const _assignLane = (entity) => {
      if (!laneYsCache) return;
      const laneIdx = resolveRunnerLaneIndex(entity.runnerLane, lanes);
      entity.position.y = laneYsCache[laneIdx];
    };

    for (const entity of this.entities) {
      const isRecyclable = entity.role === 'enemy' || entity.role === 'collectible';
      if (!isRecyclable) continue;
      const ew = entity.renderSize?.width || 32;
      if (entity.position.x + ew < this.cameraX - viewW * 0.1) {
        entity.position.x      = this.cameraX + viewW + Math.round(Math.random() * viewW * 0.8 + viewW * 0.6);
        entity._dead           = false;
        entity._vanished       = false;
        entity._hp             = entity.stats?.hp ?? 1;
        entity._aiState        = 'patrol';
        entity._invincibleTime = 0;
        entity.velocity.x      = 0;
        entity.velocity.y      = 0;
        _assignLane(entity);
        // Allow idle sound to restart on next tick.
        this._stopEntityIdleSound(entity.id);
      }
    }

    // ── Player shoot action in runner mode ─────────────────────────────────
    if (this.level.playerCanShoot) {
      const atkEdge = this.input.attack && !r._prevShoot;
      r._prevShoot = this.input.attack;
      if (atkEdge) {
        const pw = player.renderSize?.width  || 32;
        const ph = player.renderSize?.height || 32;
        this.fireProjectile({
          x: player.position.x + pw,
          y: player.position.y + ph / 2,
          angle: 0,
          speed:  this.level.playerBulletSpeed  || 600,
          damage: this.level.playerBulletDamage || 20,
          r:      this.level.playerBulletSize   || 5,
          color:  this.level.playerBulletColor  || '#fffa60',
          owner: 'player',
        });
      }
    }

    // ── Lane-switching mode ────────────────────────────────────────────────
    if (lanes > 1) {
      this._updateRunnerLanes(dt, player, lanes, viewW);
      player.velocity.x = 0;
      return;
    }

    // ── Standard (single-lane) runner contact kill ─────────────────────────
    // Grace window: if the player is actively rising (just pressed Jump), give
    // them a brief pass so a late jump still works.
    const pw = player.renderSize?.width  || 32;
    const ph = player.renderSize?.height || 32;
    const isRising = player.velocity.y < -80;
    if (!isRising) {
      for (const entity of this.entities) {
        if (entity.role !== 'enemy' || entity._dead || entity._vanished) continue;
        const ew = entity.renderSize?.width  || 32;
        const eh = entity.renderSize?.height || 32;
        // X overlap (4 px inner margin)
        if (player.position.x + pw - 4 <= entity.position.x ||
            player.position.x + 4       >= entity.position.x + ew) continue;
        // Player has cleared the obstacle top → safe
        if (player.position.y + ph <= entity.position.y + 2) continue;
        // Y overlap → ran into the obstacle
        if (player.position.y < entity.position.y + eh) {
          this._runAction(player.events?.onDeath || 'game-over');
          return;
        }
      }
    }

    // Disable horizontal player input while runner is active (camera drives X)
    player.velocity.x = 0;
  }

  // Returns array of Y positions (one per lane, index 0 = ground) using the
  // anchored ground Y captured on the first grounded frame. Returns null if
  // _laneGroundY is not yet set.
  _getRunnerLaneYs(laneCount) {
    const r = this._runner;
    if (r?._laneGroundY === undefined || r?._laneGroundY === null) return null;
    const tm = this.level.tileMap || {};
    const tileH = tm.tileHeight || 32;
    const topY  = tileH * 2;
    const laneSpacing = this.level.runnerLaneSpacing || 0;
    const laneStep = laneSpacing > 0
      ? laneSpacing
      : (laneCount > 1 ? (r._laneGroundY - topY) / (laneCount - 1) : 0);
    return Array.from({ length: laneCount }, (_, i) => Math.round(r._laneGroundY - i * laneStep));
  }

  // ── Lane runner — Up/Down to switch lanes, no gravity ─────────────────────
  _updateRunnerLanes(dt, player, laneCount, viewW) {
    const r  = this._runner;
    const ph = player.renderSize?.height || 64;

    // Anchor lane 0 to the player's actual resting Y on the first grounded frame.
    if (r._laneGroundY === undefined) {
      if (!player.onGround) return;
      r._laneGroundY = player.position.y;
    }

    const laneYs = this._getRunnerLaneYs(laneCount);
    if (!laneYs) return;

    if (r._laneIdx === undefined) r._laneIdx = 0;
    if (r._laneTargetY === undefined) r._laneTargetY = laneYs[r._laneIdx];

    // Detect up/down press edges
    const upEdge   = this.input.up   && !r._prevLaneUp;
    const downEdge = this.input.down && !r._prevLaneDown;
    r._prevLaneUp   = this.input.up;
    r._prevLaneDown = this.input.down;

    if (upEdge   && r._laneIdx < laneCount - 1) { r._laneIdx++; r._laneTargetY = laneYs[r._laneIdx]; }
    if (downEdge && r._laneIdx > 0)              { r._laneIdx--; r._laneTargetY = laneYs[r._laneIdx]; }

    // Jump detection — start jump when space pressed and not already airborne
    const jumpEdge = this.input.jump && !r._prevJump;
    r._prevJump = this.input.jump;
    if (jumpEdge && !r._isJumping) r._isJumping = true;

    if (r._isJumping) {
      // Re-engage lane lock when player returns to (or below) the target lane Y
      if (player.position.y >= r._laneTargetY - 4 && player.velocity.y >= 0) {
        r._isJumping = false;
        player.position.y = r._laneTargetY;
        player.velocity.y = 0;
        player.onGround   = true;
      }
      // While airborne, physics owns Y — just ensure X is locked
    } else {
      // Lane lock: lerp player Y to target lane, override gravity
      const LANE_SPEED = 700;
      const dy = r._laneTargetY - player.position.y;
      player.position.y = Math.abs(dy) > 0.5
        ? player.position.y + Math.sign(dy) * Math.min(Math.abs(dy), LANE_SPEED * dt)
        : r._laneTargetY;
      player.velocity.y = 0;
      player.onGround   = true;
    }

    // Contact kill: player center Y inside obstacle Y range + X overlap
    const pw       = player.renderSize?.width || 32;
    const playerCY = player.position.y + ph / 2;
    for (const entity of this.entities) {
      if (entity.role !== 'enemy' || entity._dead || entity._vanished) continue;
      const ew = entity.renderSize?.width  || 32;
      const eh = entity.renderSize?.height || 32;
      if (player.position.x + pw - 4 <= entity.position.x ||
          player.position.x + 4       >= entity.position.x + ew) continue;
      if (playerCY > entity.position.y + 2 && playerCY < entity.position.y + eh - 2) {
        this._runAction(player.events?.onDeath || 'game-over');
        return;
      }
    }
  }

  // ── Arcade Mode Dispatcher ─────────────────────────────────────────────────
  _initArcade() {
    switch (this.arcadeMode) {
      case 'casual.flappy-bird':        this._initFlappy();         break;
      case 'arcade.space-invaders':     this._initSpaceInvaders();  break;
      case 'arcade.pong':               this._initPong();           break;
      case 'arcade.breakout':           this._initBreakout();       break;
      case 'arcade.snake':              this._initSnake();          break;
      case 'strategy.tower-defense':    this._initTD();             break;
      case 'strategy.match-3':          this._initMatch3();         break;
      case 'card.blackjack':            this._initBlackjack();      break;
      case 'card.solitaire':            this._initSolitaire();      break;
      case 'racing.top-down':           this._initRacing();         break;
      case 'racing.endless':            this._initEndlessRoad();    break;
      case 'rhythm.lane-tap':           this._initRhythm();         break;
      case 'fighting.brawler':          this._initFighting();       break;
    }
  }

  _updateArcade(dt) {
    switch (this.arcadeMode) {
      case 'casual.flappy-bird':        this._updateFlappy(dt);         break;
      case 'arcade.space-invaders':     this._updateSpaceInvaders(dt);  break;
      case 'arcade.pong':               this._updatePong(dt);           break;
      case 'arcade.breakout':           this._updateBreakout(dt);       break;
      case 'arcade.snake':              this._updateSnake(dt);          break;
      case 'strategy.tower-defense':    this._updateTD(dt);             break;
      case 'strategy.match-3':          this._updateMatch3(dt);         break;
      case 'card.blackjack':            this._updateBlackjack(dt);      break;
      case 'card.solitaire':            this._updateSolitaire(dt);      break;
      case 'racing.top-down':           this._updateRacing(dt);         break;
      case 'racing.endless':            this._updateEndlessRoad(dt);    break;
      case 'rhythm.lane-tap':           this._updateRhythm(dt);         break;
      case 'fighting.brawler':          this._updateFighting(dt);       break;
    }
    // Flash decay runs for all arcade modes.
    if (this.gameState.flashScreen > 0) {
      this.gameState.flashScreen = Math.max(0, this.gameState.flashScreen - dt);
    }
  }

  _drawArcade() {
    switch (this.arcadeMode) {
      case 'casual.flappy-bird':        this._drawFlappy();         break;
      case 'arcade.space-invaders':     this._drawSpaceInvaders();  break;
      case 'arcade.pong':               this._drawPong();           break;
      case 'arcade.breakout':           this._drawBreakout();       break;
      case 'arcade.snake':              this._drawSnake();          break;
      case 'strategy.tower-defense':    this._drawTD();             break;
      case 'strategy.match-3':          this._drawMatch3();         break;
      case 'card.blackjack':            this._drawBlackjack();      break;
      case 'card.solitaire':            this._drawSolitaire();      break;
      case 'racing.top-down':           this._drawRacing();         break;
      case 'racing.endless':            this._drawEndlessRoad();    break;
      case 'rhythm.lane-tap':           this._drawRhythm();         break;
      case 'fighting.brawler':          this._drawFighting();       break;
    }
    if (this.gameState.flashScreen > 0) {
      const a = Math.min(0.55, this.gameState.flashScreen * 1.5);
      this.ctx.fillStyle = `rgba(255,60,60,${a})`;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  _resetArcade() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const player = this.entities.find(e => e.role === 'playerMain');
    switch (this.arcadeMode) {
      case 'casual.flappy-bird': {
        this._fb.pipes = [];
        this._fb.spawnTimer = 1.5;
        if (player) {
          player.position.x = Math.round(W * 0.20);
          player.position.y = Math.round(H * 0.40);
          player.velocity.x = 0;
          player.velocity.y = 0;
          player._vanished  = false;
          player._dead      = false;
        }
        break;
      }
      case 'arcade.space-invaders': {
        if (player) {
          const pw = player.renderSize?.width || 32;
          const ph = player.renderSize?.height || 32;
          player.position.x = Math.round(W / 2) - pw / 2;
          player.position.y = H - ph - 8;
          player.velocity.x = 0;
          player.velocity.y = 0;
          player._vanished  = false;
          player._dead      = false;
        }
        break;
      }
      case 'arcade.pong': {
        this._resetPongBall();
        if (player) player._vanished = true;
        break;
      }
      case 'arcade.breakout': {
        const speed = Math.round(Math.max(W, H) * 0.5);
        const br = this._br;
        br.ball.x  = W / 2;
        br.ball.y  = H * 0.6;
        br.ball.vx = speed * (Math.random() > 0.5 ? 0.7 : -0.7);
        br.ball.vy = -speed * 0.7;
        if (player) player._vanished = true;
        break;
      }
      case 'arcade.snake': {
        if (player) player._vanished = true;
        break;
      }
      case 'strategy.tower-defense': this._resetTD();         break;
      case 'strategy.match-3':       this._resetMatch3();     break;
      case 'card.blackjack':         this._resetBlackjack();     break;
      case 'card.solitaire':         this._resetSolitaire();     break;
      case 'racing.top-down':        this._resetRacing();        break;
      case 'racing.endless':         this._resetEndlessRoad();   break;
      case 'rhythm.lane-tap':        this._resetRhythm();        break;
      case 'fighting.brawler':       this._resetFighting();      break;
    }
  }

  // ── Flappy Bird ────────────────────────────────────────────────────────────
  _initFlappy() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    this._fb = {
      pipes: [],
      spawnTimer: 1.8,
      pipeGap:   Math.round(H * 0.33),
      pipeW:     Math.round(W * 0.08),
      pipeSpeed: Math.round(W * 0.18),
    };
    const player = this.entities.find(e => e.role === 'playerMain');
    if (player) {
      player.position.x = Math.round(W * 0.20);
      player.position.y = Math.round(H * 0.40);
      player.velocity.x = 0;
      player.velocity.y = 0;
    }
  }

  _updateFlappy(dt) {
    if (this.gameState.gameOver || this.gameState.levelComplete) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const fb = this._fb;
    const gravity = this.level.gravity || 600;
    const player = this.entities.find(e => e.role === 'playerMain');

    if (player && !player._dead && !player._vanished) {
      // Gravity
      player.velocity.y += gravity * dt;
      player.position.y += player.velocity.y * dt;

      // Jump impulse — any action input triggers flap
      const jumpNow = this.input.jump || this.input.attack || this.input.interact;
      if (jumpNow && !this._prevFlappyJump) {
        player.velocity.y = -Math.sqrt(2 * gravity * H * 0.22);
      }
      this._prevFlappyJump = jumpNow;

      // Ceiling
      if (player.position.y < 0) {
        player.position.y = 0;
        player.velocity.y = Math.abs(player.velocity.y) * 0.3;
      }
    } else {
      this._prevFlappyJump = false;
    }

    // Spawn pipes
    fb.spawnTimer -= dt;
    if (fb.spawnTimer <= 0) {
      const minTopH = Math.round(H * 0.15);
      const maxTopH = H - fb.pipeGap - minTopH;
      const topH    = minTopH + Math.floor(Math.random() * Math.max(1, maxTopH - minTopH));
      fb.pipes.push({ x: W, topH, botY: topH + fb.pipeGap, passed: false });
      fb.spawnTimer = 1.8 + Math.random() * 0.5;
    }

    // Move pipes
    for (const pipe of fb.pipes) {
      pipe.x -= fb.pipeSpeed * dt;
      if (!pipe.passed && player && pipe.x + fb.pipeW < player.position.x) {
        pipe.passed = true;
        this._runAction('add-score:1');
      }
    }
    fb.pipes = fb.pipes.filter(p => p.x + fb.pipeW > 0);

    // Collision with pipes or ground
    if (player && !player._dead && !player._vanished) {
      const pw = player.renderSize?.width  || 28;
      const ph = player.renderSize?.height || 28;
      // Ground
      if (player.position.y + ph >= H) {
        this._runAction(this.gameState.lives > 1 ? 'lose-life' : 'game-over');
        return;
      }
      // Pipes (shrink hitbox 20% for fairness)
      const hx = player.position.x + pw * 0.1;
      const hy = player.position.y + ph * 0.1;
      const hw = pw * 0.8;
      const hh = ph * 0.8;
      for (const pipe of fb.pipes) {
        if (hx + hw > pipe.x && hx < pipe.x + fb.pipeW) {
          if (hy < pipe.topH || hy + hh > pipe.botY) {
            this._runAction(this.gameState.lives > 1 ? 'lose-life' : 'game-over');
            return;
          }
        }
      }
    }

    this._emitState();
  }

  _drawFlappy() {
    const ctx  = this.ctx;
    const H    = this.canvas.height;
    const fb   = this._fb;
    const pipeCapH = Math.round(H * 0.05);
    const pipeCapX = 3;
    for (const pipe of fb.pipes) {
      // Top pipe body
      ctx.fillStyle = '#2e8b3a';
      ctx.fillRect(pipe.x, 0, fb.pipeW, pipe.topH);
      // Top pipe cap
      ctx.fillStyle = '#3cb449';
      ctx.fillRect(pipe.x - pipeCapX, pipe.topH - pipeCapH, fb.pipeW + pipeCapX * 2, pipeCapH);
      // Bottom pipe body
      ctx.fillStyle = '#2e8b3a';
      ctx.fillRect(pipe.x, pipe.botY, fb.pipeW, H - pipe.botY);
      // Bottom pipe cap
      ctx.fillStyle = '#3cb449';
      ctx.fillRect(pipe.x - pipeCapX, pipe.botY, fb.pipeW + pipeCapX * 2, pipeCapH);
    }
  }

  // ── Space Invaders ─────────────────────────────────────────────────────────
  _initSpaceInvaders() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const alienCols = 8;
    const alienRows = 4;
    const alienW = Math.round(W / 16);
    const alienH = Math.round(alienW * 0.75);
    const gapX   = Math.round(W * 0.035);
    const gapY   = Math.round(H * 0.045);
    const totalW = alienCols * (alienW + gapX) - gapX;
    const startX = (W - totalW) / 2;
    const startY = Math.round(H * 0.08);

    const aliens = [];
    for (let r = 0; r < alienRows; r++) {
      for (let c = 0; c < alienCols; c++) {
        aliens.push({
          x: startX + c * (alienW + gapX),
          y: startY + r * (alienH + gapY),
          w: alienW, h: alienH, alive: true, row: r,
        });
      }
    }

    this._si = {
      aliens,
      bullets:      [],
      alienBullets: [],
      dir:          1,
      marchTimer:   0,
      marchInterval: Math.max(0.3, 0.7 - aliens.length * 0.002),
      marchStep:    Math.round(W * 0.018),
      descendStep:  Math.round(H * 0.03),
      shootTimer:   0,
      shootInterval: 1.4,
      bulletW: 3, bulletH: 10,
      bulletSpeed: Math.round(H * 0.65),
      alienW, alienH,
    };

    const player = this.entities.find(e => e.role === 'playerMain');
    if (player) {
      const pw = player.renderSize?.width || 32;
      const ph = player.renderSize?.height || 32;
      player.position.x = W / 2 - pw / 2;
      player.position.y = H - ph - 8;
      player.velocity.x = 0;
      player.velocity.y = 0;
    }
  }

  _updateSpaceInvaders(dt) {
    if (this.gameState.gameOver || this.gameState.levelComplete) return;
    const W  = this.canvas.width;
    const H  = this.canvas.height;
    const si = this._si;
    const player = this.entities.find(e => e.role === 'playerMain');
    const pw = player ? (player.renderSize?.width  || 32) : 32;
    const ph = player ? (player.renderSize?.height || 32) : 32;

    // Player movement (horizontal only, no gravity)
    if (player && !player._dead && !player._vanished) {
      const speed = this.level.playerStats?.speed || 200;
      if (this.input.left)  player.position.x = Math.max(0, player.position.x - speed * dt);
      if (this.input.right) player.position.x = Math.min(W - pw, player.position.x + speed * dt);
      player.velocity.x = 0;
      player.velocity.y = 0;

      // Player fires (attack edge)
      const attackEdge = this.input.attack && !this._prevSiAttack;
      if (attackEdge) {
        si.bullets.push({
          x: player.position.x + pw / 2 - si.bulletW / 2,
          y: player.position.y,
          vy: -si.bulletSpeed,
        });
      }
    }
    this._prevSiAttack = this.input.attack;

    // Move player bullets, check alien hits
    for (const b of si.bullets) {
      b.y += b.vy * dt;
      for (const alien of si.aliens) {
        if (!alien.alive) continue;
        if (b.x < alien.x + alien.w && b.x + si.bulletW > alien.x &&
            b.y < alien.y + alien.h && b.y + si.bulletH > alien.y) {
          alien.alive = false;
          b.y = -999;
          this._runAction(`add-score:${(3 - alien.row) * 10 + 10}`);
        }
      }
    }
    si.bullets = si.bullets.filter(b => b.y > -si.bulletH);

    // Alien march
    si.marchTimer -= dt;
    if (si.marchTimer <= 0) {
      si.marchTimer = si.marchInterval;
      const live = si.aliens.filter(a => a.alive);
      let needDescend = false;
      for (const a of live) {
        if ((si.dir === 1  && a.x + a.w + si.marchStep > W * 0.95) ||
            (si.dir === -1 && a.x - si.marchStep < W * 0.05)) {
          needDescend = true; break;
        }
      }
      if (needDescend) {
        si.dir *= -1;
        for (const a of si.aliens) a.y += si.descendStep;
        si.marchInterval = Math.max(0.08, si.marchInterval * 0.90);
      } else {
        for (const a of si.aliens) a.x += si.dir * si.marchStep;
      }
    }

    // Aliens reach player → game over
    if (player) {
      for (const a of si.aliens) {
        if (a.alive && a.y + a.h >= player.position.y) { this._runAction('game-over'); return; }
      }
    }

    // Alien shoots
    si.shootTimer -= dt;
    if (si.shootTimer <= 0) {
      si.shootTimer = si.shootInterval * (0.7 + Math.random() * 0.6);
      const live = si.aliens.filter(a => a.alive);
      if (live.length) {
        const shooter = live[Math.floor(Math.random() * live.length)];
        si.alienBullets.push({
          x: shooter.x + shooter.w / 2 - si.bulletW / 2,
          y: shooter.y + shooter.h,
          vy: si.bulletSpeed * 0.55,
        });
      }
    }

    // Move alien bullets, check player hit
    for (const b of si.alienBullets) b.y += b.vy * dt;
    if (player && !player._dead && !player._vanished) {
      for (const b of si.alienBullets) {
        if (b.x < player.position.x + pw && b.x + si.bulletW > player.position.x &&
            b.y < player.position.y + ph && b.y + si.bulletH > player.position.y) {
          b.y = H + 99;
          this._runAction('lose-life');
          return;
        }
      }
    }
    si.alienBullets = si.alienBullets.filter(b => b.y < H + si.bulletH);

    // Win: all aliens dead
    if (si.aliens.every(a => !a.alive)) { this._runAction('next-level'); }
    this._emitState();
  }

  _drawSpaceInvaders() {
    const ctx = this.ctx;
    const si  = this._si;
    for (const alien of si.aliens) {
      if (!alien.alive) continue;
      const hue = 120 + alien.row * 30;
      ctx.fillStyle = `hsl(${hue}, 80%, 62%)`;
      ctx.fillRect(alien.x, alien.y, alien.w, alien.h);
      ctx.fillStyle = `hsl(${hue}, 80%, 28%)`;
      ctx.fillRect(alien.x + alien.w * 0.2, alien.y + alien.h * 0.3, alien.w * 0.6, alien.h * 0.4);
    }
    ctx.fillStyle = '#fffa60';
    for (const b of si.bullets)      ctx.fillRect(b.x, b.y, si.bulletW, si.bulletH);
    ctx.fillStyle = '#ff5555';
    for (const b of si.alienBullets) ctx.fillRect(b.x, b.y, si.bulletW, si.bulletH);
  }

  // ── Pong ───────────────────────────────────────────────────────────────────
  _initPong() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const paddleW = Math.max(6, Math.round(W * 0.018));
    const paddleH = Math.round(H * 0.20);
    const ballR   = Math.max(4, Math.round(Math.min(W, H) * 0.013));
    const speed   = Math.round(Math.max(W, H) * 0.55);
    const px = Math.round(W * 0.035);

    this._pong = {
      ball: {
        x: W / 2, y: H / 2,
        vx: speed * (Math.random() > 0.5 ? 1 : -1),
        vy: speed * (Math.random() > 0.5 ? 0.55 : -0.55),
        r: ballR,
        baseSpeed: speed,
      },
      playerPaddle: { x: px, y: H / 2 - paddleH / 2, w: paddleW, h: paddleH },
      aiPaddle:     { x: W - px - paddleW, y: H / 2 - paddleH / 2, w: paddleW, h: paddleH },
      paddleSpeed:  Math.round(H * 1.05),
      score:        { player: 0, ai: 0 },
      winScore:     5,
      speedMult:    1.06,
    };
    const player = this.entities.find(e => e.role === 'playerMain');
    if (player) player._vanished = true;
  }

  _updatePong(dt) {
    if (this.gameState.gameOver || this.gameState.levelComplete) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const p = this._pong;

    // Player paddle
    if (this.input.up || this.input.left)
      p.playerPaddle.y = Math.max(0, p.playerPaddle.y - p.paddleSpeed * dt);
    if (this.input.down || this.input.right)
      p.playerPaddle.y = Math.min(H - p.playerPaddle.h, p.playerPaddle.y + p.paddleSpeed * dt);

    // AI paddle follows ball (slightly imperfect)
    const aiCenter = p.aiPaddle.y + p.aiPaddle.h / 2;
    const aiSpeed  = p.paddleSpeed * 0.76;
    if (aiCenter < p.ball.y - 4) p.aiPaddle.y = Math.min(H - p.aiPaddle.h, p.aiPaddle.y + aiSpeed * dt);
    if (aiCenter > p.ball.y + 4) p.aiPaddle.y = Math.max(0, p.aiPaddle.y - aiSpeed * dt);

    // Move ball
    p.ball.x += p.ball.vx * dt;
    p.ball.y += p.ball.vy * dt;

    // Top / bottom walls
    if (p.ball.y - p.ball.r < 0)  { p.ball.y = p.ball.r;      p.ball.vy =  Math.abs(p.ball.vy); }
    if (p.ball.y + p.ball.r > H)  { p.ball.y = H - p.ball.r;  p.ball.vy = -Math.abs(p.ball.vy); }

    // Player paddle collision
    const pl = p.playerPaddle;
    if (p.ball.vx < 0 &&
        p.ball.x - p.ball.r < pl.x + pl.w && p.ball.x + p.ball.r > pl.x &&
        p.ball.y + p.ball.r > pl.y         && p.ball.y - p.ball.r < pl.y + pl.h) {
      const rel = (p.ball.y - (pl.y + pl.h / 2)) / (pl.h / 2);
      const spd = Math.min(p.ball.baseSpeed * 2.5, Math.hypot(p.ball.vx, p.ball.vy) * p.speedMult);
      const angle = rel * (Math.PI / 3);
      p.ball.vx =  Math.abs(spd * Math.cos(angle));
      p.ball.vy = spd * Math.sin(angle);
      p.ball.x  = pl.x + pl.w + p.ball.r;
    }

    // AI paddle collision
    const ai = p.aiPaddle;
    if (p.ball.vx > 0 &&
        p.ball.x + p.ball.r > ai.x && p.ball.x - p.ball.r < ai.x + ai.w &&
        p.ball.y + p.ball.r > ai.y  && p.ball.y - p.ball.r < ai.y + ai.h) {
      const rel = (p.ball.y - (ai.y + ai.h / 2)) / (ai.h / 2);
      const spd = Math.min(p.ball.baseSpeed * 2.5, Math.hypot(p.ball.vx, p.ball.vy) * p.speedMult);
      const angle = rel * (Math.PI / 3);
      p.ball.vx = -Math.abs(spd * Math.cos(angle));
      p.ball.vy = spd * Math.sin(angle);
      p.ball.x  = ai.x - p.ball.r;
    }

    // Score
    if (p.ball.x + p.ball.r < 0) {
      p.score.ai++;
      this._resetPongBall();
      if (p.score.ai >= p.winScore) { this._runAction('game-over'); return; }
    }
    if (p.ball.x - p.ball.r > W) {
      p.score.player++;
      this._runAction('add-score:1');
      this._resetPongBall();
      if (p.score.player >= p.winScore) { this._runAction('next-level'); return; }
    }
    this._emitState();
  }

  _resetPongBall() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const p = this._pong;
    const spd = p.ball.baseSpeed;
    p.ball.x  = W / 2; p.ball.y = H / 2;
    p.ball.vx = spd * (Math.random() > 0.5 ? 1 : -1);
    p.ball.vy = spd * (Math.random() > 0.5 ? 0.5 : -0.5);
  }

  _drawPong() {
    const ctx = this.ctx;
    const p   = this._pong;
    const W   = this.canvas.width;
    const H   = this.canvas.height;
    const fontSize = Math.round(H * 0.09);

    // Dashed center line
    ctx.save();
    ctx.setLineDash([Math.round(H * 0.04), Math.round(H * 0.03)]);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth   = 2;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.restore();

    // Paddles
    ctx.fillStyle = '#fff';
    ctx.fillRect(p.playerPaddle.x, p.playerPaddle.y, p.playerPaddle.w, p.playerPaddle.h);
    ctx.fillRect(p.aiPaddle.x,     p.aiPaddle.y,     p.aiPaddle.w,     p.aiPaddle.h);

    // Ball
    ctx.beginPath();
    ctx.arc(p.ball.x, p.ball.y, p.ball.r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();

    // Scores
    ctx.font      = `bold ${fontSize}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textAlign = 'center';
    ctx.fillText(p.score.player, W * 0.25, fontSize * 1.1);
    ctx.fillText(p.score.ai,     W * 0.75, fontSize * 1.1);
    ctx.textAlign = 'left';
  }

  // ── Breakout ───────────────────────────────────────────────────────────────
  _initBreakout() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const bCols = 10;
    const bRows = 5;
    const gap   = 3;
    const bW    = Math.round((W * 0.9 - gap * (bCols - 1)) / bCols);
    const bH    = Math.round(H * 0.04);
    const startX = (W - (bCols * (bW + gap) - gap)) / 2;
    const startY = Math.round(H * 0.10);
    const bricks = [];
    for (let r = 0; r < bRows; r++) {
      for (let c = 0; c < bCols; c++) {
        bricks.push({ x: startX + c * (bW + gap), y: startY + r * (bH + gap), w: bW, h: bH, alive: true, row: r });
      }
    }
    const paddleW = Math.round(W * 0.16);
    const paddleH = Math.round(H * 0.025);
    const ballR   = Math.max(4, Math.round(Math.min(W, H) * 0.013));
    const speed   = Math.round(Math.max(W, H) * 0.52);

    this._br = {
      ball: { x: W / 2, y: H * 0.6, vx: speed * 0.65, vy: -speed * 0.75, r: ballR, baseSpeed: speed },
      paddle: { x: (W - paddleW) / 2, y: H - paddleH - 18, w: paddleW, h: paddleH },
      bricks, bCols, bRows, bW, bH,
      paddleSpeed: Math.round(W * 1.0),
    };
    const player = this.entities.find(e => e.role === 'playerMain');
    if (player) player._vanished = true;
  }

  _updateBreakout(dt) {
    if (this.gameState.gameOver || this.gameState.levelComplete) return;
    const W  = this.canvas.width;
    const H  = this.canvas.height;
    const br = this._br;

    // Paddle movement (left/right or touch)
    if (this.input.left)  br.paddle.x = Math.max(0, br.paddle.x - br.paddleSpeed * dt);
    if (this.input.right) br.paddle.x = Math.min(W - br.paddle.w, br.paddle.x + br.paddleSpeed * dt);

    // Move ball
    br.ball.x += br.ball.vx * dt;
    br.ball.y += br.ball.vy * dt;

    // Wall bounces
    if (br.ball.x - br.ball.r < 0)  { br.ball.x = br.ball.r;       br.ball.vx =  Math.abs(br.ball.vx); }
    if (br.ball.x + br.ball.r > W)  { br.ball.x = W - br.ball.r;   br.ball.vx = -Math.abs(br.ball.vx); }
    if (br.ball.y - br.ball.r < 0)  { br.ball.y = br.ball.r;       br.ball.vy =  Math.abs(br.ball.vy); }

    // Ball exits below
    if (br.ball.y - br.ball.r > H) {
      this._runAction('lose-life');
      const spd = br.ball.baseSpeed;
      br.ball.x  = W / 2; br.ball.y = H * 0.6;
      br.ball.vx = spd * (Math.random() > 0.5 ? 0.65 : -0.65);
      br.ball.vy = -spd * 0.75;
      return;
    }

    // Paddle collision
    const pd = br.paddle;
    if (br.ball.vy > 0 &&
        br.ball.y + br.ball.r >= pd.y && br.ball.y - br.ball.r <= pd.y + pd.h &&
        br.ball.x + br.ball.r > pd.x  && br.ball.x - br.ball.r < pd.x + pd.w) {
      const rel  = (br.ball.x - (pd.x + pd.w / 2)) / (pd.w / 2);
      const spd  = Math.min(br.ball.baseSpeed * 2.2, Math.hypot(br.ball.vx, br.ball.vy) * 1.03);
      const angle = rel * (Math.PI * 0.35);
      br.ball.vx = spd * Math.sin(angle);
      br.ball.vy = -Math.abs(spd * Math.cos(angle));
      br.ball.y  = pd.y - br.ball.r;
    }

    // Brick collisions
    for (const brick of br.bricks) {
      if (!brick.alive) continue;
      const overX = br.ball.x + br.ball.r > brick.x && br.ball.x - br.ball.r < brick.x + brick.w;
      const overY = br.ball.y + br.ball.r > brick.y && br.ball.y - br.ball.r < brick.y + brick.h;
      if (overX && overY) {
        brick.alive = false;
        this._runAction(`add-score:${(br.bRows - brick.row) * 10}`);
        const fromLeft  = br.ball.vx > 0 && Math.abs(br.ball.x - brick.x) < Math.abs(br.ball.y - brick.y);
        const fromRight = br.ball.vx < 0 && Math.abs(br.ball.x - (brick.x + brick.w)) < Math.abs(br.ball.y - brick.y);
        if (fromLeft || fromRight) br.ball.vx *= -1; else br.ball.vy *= -1;
        break;
      }
    }

    if (br.bricks.every(b => !b.alive)) this._runAction('next-level');
    this._emitState();
  }

  _drawBreakout() {
    const ctx = this.ctx;
    const br  = this._br;
    for (const brick of br.bricks) {
      if (!brick.alive) continue;
      const hue = 200 + brick.row * 32;
      ctx.fillStyle = `hsl(${hue}, 78%, 55%)`;
      ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
      ctx.strokeStyle = `hsl(${hue}, 78%, 30%)`;
      ctx.lineWidth   = 1;
      ctx.strokeRect(brick.x, brick.y, brick.w, brick.h);
    }
    ctx.fillStyle = '#ddd';
    ctx.fillRect(br.paddle.x, br.paddle.y, br.paddle.w, br.paddle.h);
    ctx.beginPath();
    ctx.arc(br.ball.x, br.ball.y, br.ball.r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe';
    ctx.fill();
  }

  // ── Snake ──────────────────────────────────────────────────────────────────
  _initSnake() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const gs = Math.round(Math.min(W, H) * 0.052);
    const gW = Math.floor(W / gs);
    const gH = Math.floor(H / gs);
    const hx = Math.floor(gW / 2);
    const hy = Math.floor(gH / 2);

    this._sn = {
      gs, gW, gH,
      segments: [{ x: hx, y: hy }, { x: hx - 1, y: hy }, { x: hx - 2, y: hy }],
      dir:          { x: 1, y: 0 },
      nextDir:      { x: 1, y: 0 },
      moveTimer:    0,
      moveInterval: 0.15,
      food:         null,
      growing:      0,
    };
    this._spawnSnakeFood();
    const player = this.entities.find(e => e.role === 'playerMain');
    if (player) player._vanished = true;
  }

  _spawnSnakeFood() {
    const sn = this._sn;
    let fx, fy, tries = 0;
    do {
      fx = Math.floor(Math.random() * sn.gW);
      fy = Math.floor(Math.random() * sn.gH);
      tries++;
    } while (tries < 200 && sn.segments.some(s => s.x === fx && s.y === fy));
    sn.food = { x: fx, y: fy };
  }

  _updateSnake(dt) {
    if (this.gameState.gameOver || this.gameState.levelComplete) return;
    const sn = this._sn;

    // Direction — no 180-degree reversal
    if (this.input.left  && sn.dir.x !==  1) sn.nextDir = { x: -1, y:  0 };
    if (this.input.right && sn.dir.x !== -1) sn.nextDir = { x:  1, y:  0 };
    if (this.input.up    && sn.dir.y !==  1) sn.nextDir = { x:  0, y: -1 };
    if (this.input.down  && sn.dir.y !== -1) sn.nextDir = { x:  0, y:  1 };

    sn.moveTimer -= dt;
    if (sn.moveTimer > 0) return;
    sn.moveTimer = sn.moveInterval;
    sn.dir = { ...sn.nextDir };

    const head    = sn.segments[0];
    const newHead = {
      x: (head.x + sn.dir.x + sn.gW) % sn.gW,
      y: (head.y + sn.dir.y + sn.gH) % sn.gH,
    };

    // Self-collision
    if (sn.segments.some(s => s.x === newHead.x && s.y === newHead.y)) {
      this._runAction('game-over'); return;
    }

    sn.segments.unshift(newHead);

    // Food
    if (sn.food && newHead.x === sn.food.x && newHead.y === sn.food.y) {
      this._runAction('add-score:10');
      sn.growing++;
      sn.moveInterval = Math.max(0.055, sn.moveInterval * 0.97);
      this._spawnSnakeFood();
    }

    if (sn.growing > 0) sn.growing--;
    else sn.segments.pop();

    this._emitState();
  }

  _drawSnake() {
    const ctx = this.ctx;
    const sn  = this._sn;
    const gs  = sn.gs;
    // Food
    if (sn.food) {
      ctx.fillStyle = '#ff4040';
      ctx.beginPath();
      ctx.arc(sn.food.x * gs + gs / 2, sn.food.y * gs + gs / 2, gs * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
    // Snake body
    for (let i = 0; i < sn.segments.length; i++) {
      const seg = sn.segments[i];
      const t   = i / Math.max(sn.segments.length - 1, 1);
      ctx.fillStyle = `hsl(120, 70%, ${Math.round(55 - t * 22)}%)`;
      ctx.fillRect(seg.x * gs + 1, seg.y * gs + 1, gs - 2, gs - 2);
    }
    // Eyes on head
    if (sn.segments.length > 0) {
      const h   = sn.segments[0];
      const es  = Math.max(2, Math.round(gs * 0.15));
      ctx.fillStyle = '#000';
      ctx.fillRect(h.x * gs + Math.round(gs * 0.25), h.y * gs + Math.round(gs * 0.25), es, es);
      ctx.fillRect(h.x * gs + Math.round(gs * 0.60), h.y * gs + Math.round(gs * 0.25), es, es);
    }
  }

  // ── Top-Down Intelligence ──────────────────────────────────────────────────

  _isVampireMode() {
    return this._gameType.primary === 'topdown' && this._gameType.secondary === 'vampire-survivors';
  }

  _isSurvivalMode() {
    return this._gameType.primary === 'topdown' && this._gameType.secondary === 'survival-waves';
  }

  // Public: fire one projectile from (x, y) along angle (radians).
  // owner: 'player' | 'enemy' — prevents friendly fire.
  fireProjectile({ x, y, angle = 0, speed = 400, damage = 20, r = 5, ttl = 2.5, color = '#fffa60', owner = 'player' }) {
    this._projectiles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r, ttl, damage, color, owner });
  }

  _updateProjectiles(dt) {
    const W = this.canvas.width  + this.cameraX + 200;
    const H = this.canvas.height + this.cameraY + 200;
    for (let i = this._projectiles.length - 1; i >= 0; i--) {
      const p = this._projectiles[i];
      p.x   += p.vx * dt;
      p.y   += p.vy * dt;
      p.ttl -= dt;
      if (p.ttl <= 0 || p.x < this.cameraX - 200 || p.y < this.cameraY - 200 || p.x > W || p.y > H) {
        this._projectiles.splice(i, 1);
        continue;
      }
      if (this.tileCollide(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2)) {
        this._projectiles.splice(i, 1);
        continue;
      }
      if (p.owner === 'player') {
        let hit = false;
        for (const entity of this.entities) {
          if (entity.role !== 'enemy' || entity._dead || entity._vanished) continue;
          const ew = entity.renderSize?.width  || 32;
          const eh = entity.renderSize?.height || 32;
          if (p.x + p.r > entity.position.x && p.x - p.r < entity.position.x + ew &&
              p.y + p.r > entity.position.y && p.y - p.r < entity.position.y + eh) {
            this.applyHitToEntity(entity, p.damage);
            this._runAction('add-score:10');
            hit = true;
            break;
          }
        }
        if (hit) { this._projectiles.splice(i, 1); }
      }
    }
  }

  _drawProjectiles() {
    if (!this._projectiles.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(-this.cameraX, -this.cameraY);
    for (const p of this._projectiles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.restore();
  }

  // Ticks designer-placed spawnWaves entries; auto-generates waves in VS/survival mode.
  _updateWaveSpawner(dt) {
    const waves = this.level.spawnWaves || [];
    this._waveTimer += dt;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const isRunner = !!this.level.runnerMode;
    const laneCount = this.level.runnerLanes || 1;
    const tileW = this.level.tileMap?.tileWidth || 32;
    const distanceTiles = isRunner ? this.cameraX / tileW : 0;

    const edgeSpawn = () => {
      const edge = Math.floor(Math.random() * 4);
      if (edge === 0) return { x: Math.random() * W + this.cameraX, y: this.cameraY - 40 };
      if (edge === 1) return { x: Math.random() * W + this.cameraX, y: this.cameraY + H + 40 };
      if (edge === 2) return { x: this.cameraX - 40,               y: Math.random() * H + this.cameraY };
      return           { x: this.cameraX + W + 40,               y: Math.random() * H + this.cameraY };
    };

    // Lane spawn for runner: right edge at the wave's assigned lane Y
    const laneSpawn = (wave, spawnIndex = 0) => {
      const laneYs = isRunner && laneCount > 1 ? this._getRunnerLaneYs(laneCount) : null;
      const x = this.cameraX + W + 60;
      let y;
      let runnerLane = null;
      if (laneYs) {
        const laneOffset = Math.max(0, this._waveIndex - 1) + spawnIndex;
        const laneIdx = resolveRunnerLaneIndex(wave.runnerLane, laneCount, laneOffset);
        runnerLane = laneIdx;
        y = laneYs[laneIdx];
      } else {
        y = this.cameraY + H / 2;
      }
      return { x, y, runnerLane };
    };

    if (waves.length) {
      while (this._waveIndex < waves.length) {
        const wave = waves[this._waveIndex];
        // Support both time-based and distance-based triggers
        const isDistanceTrigger = wave.triggerType === 'distance';
        const triggerVal = isDistanceTrigger ? (wave.triggerDistance || 0) : (wave.triggerTime || 0);
        const currentVal = isDistanceTrigger ? distanceTiles : this._waveTimer;
        if (currentVal < triggerVal) break;
        this._waveIndex++;
        this.gameState.wave = this._waveIndex;
        const count = wave.count || 4;
        for (let i = 0; i < count; i++) {
          const spawn = isRunner ? laneSpawn(wave, i) : edgeSpawn();
          const overrides = spawn.runnerLane === null ? null : { runnerLane: spawn.runnerLane };
          this._spawnWaveEnemy(spawn.x, spawn.y, wave.templateId || null, overrides);
        }
        this._emitState();
      }
      return;
    }

    // Auto-waves for VS / survival when no designer waves are defined.
    if (this._isVampireMode() || this._isSurvivalMode()) {
      const interval = Math.max(8, 20 - this.gameState.wave * 1.5);
      if (this._waveTimer >= interval) {
        this._waveTimer = 0;
        this.gameState.wave++;
        const count = 4 + this.gameState.wave * 2;
        for (let i = 0; i < count; i++) {
          const { x, y } = edgeSpawn();
          this._spawnWaveEnemy(x, y, null);
        }
        this._emitState();
        const winWaves = this.level.gameSettings?.winWaves || 0;
        if (winWaves > 0 && this.gameState.wave >= winWaves) {
          this._runAction('next-level');
        }
      }
    }
  }

  // Clones the first enemy (or the entity matching templateId) and places it at (x, y).
  _spawnWaveEnemy(x, y, templateId, overrides = null) {
    const base = templateId
      ? this.entities.find(e => e.id === templateId)
      : this.entities.find(e => e.role === 'enemy');
    if (!base) return;
    this.entities.push({
      ...base,
      id: `wave_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      position:          { x, y },
      velocity:          { x: 0, y: 0 },
      onGround:          false,
      _airborneFrames:   0,
      _hitState:         { timeLeft: 0, anim: null },
      _invincibleTime:   0,
      _hp:               base.stats?.hp ?? 100,
      _dead:             false,
      _vanished:         false,
      _deathAction:      null,
      _aiState:          'chase',
      _spawnX:           x,
      _patrolDir:        1,
      _patrolFlipCooldown: 0,
      _attackCooldown:   0,
      _attackHitSet:     null,
      _coyoteTimer:      0,
      _jumpBuffer:       0,
      _wasOnGround:      false,
      _powerups:         {},
      currentAnim:       base.defaultAnimation,
      animFrame:         0,
      animTime:          0,
      facing:            'left',
      ...(overrides || {}),
    });
  }

  // Auto-fires toward the nearest alive enemy once per autoAttackInterval.
  _updateVampire(dt, player) {
    const interval = this.level.gameSettings?.autoAttackInterval ?? 1.5;
    this._vampireAutoTimer -= dt;
    if (this._vampireAutoTimer > 0) return;
    this._vampireAutoTimer = interval;

    const pcx = player.position.x + (player.renderSize?.width  || 32) / 2;
    const pcy = player.position.y + (player.renderSize?.height || 32) / 2;

    let nearest = null;
    let nearestDist = Infinity;
    for (const entity of this.entities) {
      if (entity.role !== 'enemy' || entity._dead || entity._vanished) continue;
      const ecx = entity.position.x + (entity.renderSize?.width  || 32) / 2;
      const ecy = entity.position.y + (entity.renderSize?.height || 32) / 2;
      const dist = Math.hypot(ecx - pcx, ecy - pcy);
      if (dist < nearestDist) { nearestDist = dist; nearest = entity; }
    }

    let dx = this._aimDir.x;
    let dy = this._aimDir.y;
    if (nearest) {
      const ecx = nearest.position.x + (nearest.renderSize?.width  || 32) / 2;
      const ecy = nearest.position.y + (nearest.renderSize?.height || 32) / 2;
      const len = Math.hypot(ecx - pcx, ecy - pcy);
      if (len > 0) { dx = (ecx - pcx) / len; dy = (ecy - pcy) / len; }
    }
    this.fireProjectile({ x: pcx, y: pcy, angle: Math.atan2(dy, dx), speed: 500, damage: 25, r: 6, ttl: 1.8, color: '#c0ffa0', owner: 'player' });
  }

  _spawnXpGem(x, y) {
    this._xpGems.push({ x, y, r: 7 });
  }

  _updateXpGems(dt, player) {
    const pickupR = 52;
    const pcx = player.position.x + (player.renderSize?.width  || 32) / 2;
    const pcy = player.position.y + (player.renderSize?.height || 32) / 2;
    for (let i = this._xpGems.length - 1; i >= 0; i--) {
      const gem = this._xpGems[i];
      if (Math.hypot(gem.x - pcx, gem.y - pcy) <= pickupR) {
        this._xpGems.splice(i, 1);
        this.gameState.xp += 25;
        if (this.gameState.xp >= this.gameState.xpToNext) {
          this.gameState.xp      -= this.gameState.xpToNext;
          this.gameState.xpLevel++;
          this.gameState.xpToNext = Math.round(this.gameState.xpToNext * 1.4);
          this.gameState.flashScreen = 0.25;
        }
        this._emitState();
      }
    }
  }

  _drawXpGems() {
    if (!this._xpGems.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(-this.cameraX, -this.cameraY);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth   = 1.5;
    for (const gem of this._xpGems) {
      ctx.beginPath();
      ctx.arc(gem.x, gem.y, gem.r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd700';
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // Manual projectile fire on attack edge toward _aimDir (top-down non-VS modes only).
  _updateAimFire(dt, player) {
    if (this._getEffectivePhysics().isPlatformer) return; // platformer — no aim-fire
    const attackEdge = this.input.attack && !this._prevFireInput;
    this._prevFireInput = this.input.attack;
    if (!attackEdge) return;
    const pcx = player.position.x + (player.renderSize?.width  || 32) / 2;
    const pcy = player.position.y + (player.renderSize?.height || 32) / 2;
    this.fireProjectile({ x: pcx, y: pcy, angle: Math.atan2(this._aimDir.y, this._aimDir.x), speed: 480, damage: 20, r: 5, ttl: 2, color: '#60cfff', owner: 'player' });
  }

  // ── Tower Defense (Phase I) ────────────────────────────────────────────────

  _initTD() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const waypoints = (this.level.tdWaypoints?.length >= 2)
      ? this.level.tdWaypoints
      : this._tdAutoWaypoints(W, H);

    this._td = {
      waypoints,
      enemies:       [],
      towers:        this.entities
        .filter(e => e.role === 'tower')
        .map(e => ({
          id:       e.id,
          x:        e.position.x + (e.renderSize?.width  || 32) / 2,
          y:        e.position.y + (e.renderSize?.height || 32) / 2,
          range:    e.stats?.range    ?? 120,
          damage:   e.stats?.damage   ?? 20,
          fireRate: e.stats?.fireRate ?? 1.0,
          _cooldown: 0,
          entity:   e,
        })),
      tdProjectiles: [],
      spawnQueue:    [],
      spawnTimer:    0,
      waveIndex:     0,
      waveDelay:     5,
      waveActive:    false,
      baseHp:        this.level.gameSettings?.lives ?? 20,
    };
    this.gameState.lives = this._td.baseHp;
    this.gameState.wave  = 0;
    this._emitState();
  }

  _tdAutoWaypoints(W, H) {
    const m = Math.round(W * 0.06);
    return [
      { x: 0,     y: Math.round(H * 0.20) },
      { x: W - m, y: Math.round(H * 0.20) },
      { x: W - m, y: Math.round(H * 0.50) },
      { x: m,     y: Math.round(H * 0.50) },
      { x: m,     y: Math.round(H * 0.80) },
      { x: W,     y: Math.round(H * 0.80) },
    ];
  }

  _resetTD() {
    if (!this._td) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    this._td.waypoints    = (this.level.tdWaypoints?.length >= 2) ? this.level.tdWaypoints : this._tdAutoWaypoints(W, H);
    this._td.enemies      = [];
    this._td.tdProjectiles = [];
    this._td.spawnQueue   = [];
    this._td.spawnTimer   = 0;
    this._td.waveIndex    = 0;
    this._td.waveDelay    = 5;
    this._td.waveActive   = false;
    this._td.baseHp       = this.level.gameSettings?.lives ?? 20;
    this._td.towers.forEach(t => { t._cooldown = 0; });
    this.gameState.lives  = this._td.baseHp;
    this.gameState.score  = 0;
    this.gameState.wave   = 0;
    this.gameState.gameOver       = false;
    this.gameState.levelComplete  = false;
    this._emitState();
  }

  _updateTD(dt) {
    const td = this._td;
    if (this.gameState.gameOver || this.gameState.levelComplete) return;

    // Wave countdown
    if (!td.waveActive && td.spawnQueue.length === 0) {
      td.waveDelay -= dt;
      if (td.waveDelay <= 0) this._tdStartWave(td.waveIndex);
    }

    // Drip-spawn queued enemies
    if (td.spawnQueue.length > 0) {
      td.spawnTimer -= dt;
      if (td.spawnTimer <= 0) {
        const tmpl = td.spawnQueue.shift();
        const wp0  = td.waypoints[0];
        td.enemies.push({ x: wp0.x, y: wp0.y, hp: tmpl.hp, maxHp: tmpl.hp,
          speed: tmpl.speed, waypointIdx: 1, reward: tmpl.reward, r: tmpl.r, color: tmpl.color });
        td.spawnTimer  = tmpl.interval;
        td.waveActive  = td.spawnQueue.length > 0;
      }
    }

    this._updateTdEnemies(dt);
    this._updateTdTowers(dt);
    this._updateTdProjectiles(dt);

    // Win: all waves cleared, no enemies remaining
    const maxWaves = (this.level.spawnWaves?.length) || 10;
    if (td.waveIndex >= maxWaves && !td.waveActive && td.spawnQueue.length === 0 && td.enemies.length === 0) {
      this.gameState.levelComplete = true;
      this._emitState();
    }
  }

  _tdStartWave(waveIdx) {
    const td      = this._td;
    const defined = this.level.spawnWaves;
    let list;

    if (defined && waveIdx < defined.length) {
      const w     = defined[waveIdx];
      const count = w.count || 5;
      list = Array.from({ length: count }, () => ({
        hp: 60 + waveIdx * 20, speed: 80 + waveIdx * 10,
        reward: 10 + waveIdx * 5, r: 10, color: '#e06060', interval: 0.85,
      }));
    } else {
      const count = 4 + waveIdx * 2;
      const colors = ['#e06060', '#a060e0', '#e08840'];
      list = Array.from({ length: count }, () => ({
        hp: 60 + waveIdx * 25, speed: 70 + waveIdx * 12,
        reward: 10 + waveIdx * 5, r: 11, color: colors[waveIdx % 3], interval: 0.75,
      }));
    }

    td.spawnQueue  = list;
    td.spawnTimer  = 0;
    td.waveActive  = true;
    td.waveIndex++;
    td.waveDelay   = 8;
    this.gameState.wave = td.waveIndex;
    this._emitState();
  }

  _updateTdEnemies(dt) {
    const td = this._td;
    const wps = td.waypoints;
    for (let i = td.enemies.length - 1; i >= 0; i--) {
      const e = td.enemies[i];
      if (e.waypointIdx >= wps.length) {
        // Reached base
        td.enemies.splice(i, 1);
        td.baseHp = Math.max(0, td.baseHp - 1);
        this.gameState.lives = td.baseHp;
        this.gameState.flashScreen = 0.3;
        if (td.baseHp <= 0) this.gameState.gameOver = true;
        this._emitState();
        continue;
      }
      const tgt  = wps[e.waypointIdx];
      const dx   = tgt.x - e.x;
      const dy   = tgt.y - e.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 5) { e.waypointIdx++; }
      else { const s = e.speed * dt / dist; e.x += dx * s; e.y += dy * s; }
    }
  }

  _updateTdTowers(dt) {
    const td = this._td;
    for (const tower of td.towers) {
      tower._cooldown = Math.max(0, tower._cooldown - dt);
      if (tower._cooldown > 0) continue;
      // Find nearest enemy in range
      let nearest = null, nearestD = Infinity;
      for (const e of td.enemies) {
        const d = Math.hypot(e.x - tower.x, e.y - tower.y);
        if (d <= tower.range && d < nearestD) { nearest = e; nearestD = d; }
      }
      if (!nearest) continue;
      const angle = Math.atan2(nearest.y - tower.y, nearest.x - tower.x);
      td.tdProjectiles.push({
        x: tower.x, y: tower.y,
        vx: Math.cos(angle) * 350, vy: Math.sin(angle) * 350,
        damage: tower.damage, r: 4, color: '#ffdd44',
        ttl: tower.range / 350 + 0.12,
      });
      tower._cooldown = 1 / tower.fireRate;
    }
  }

  _updateTdProjectiles(dt) {
    const td = this._td;
    for (let i = td.tdProjectiles.length - 1; i >= 0; i--) {
      const p = td.tdProjectiles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.ttl -= dt;
      if (p.ttl <= 0) { td.tdProjectiles.splice(i, 1); continue; }
      let hit = false;
      for (let j = td.enemies.length - 1; j >= 0; j--) {
        const e = td.enemies[j];
        if (Math.hypot(p.x - e.x, p.y - e.y) <= e.r + p.r) {
          e.hp -= p.damage;
          if (e.hp <= 0) {
            this.gameState.score += e.reward;
            this.gameState.coins++;
            td.enemies.splice(j, 1);
            this._emitState();
          }
          hit = true; break;
        }
      }
      if (hit) td.tdProjectiles.splice(i, 1);
    }
  }

  _drawTD() {
    const ctx = this.ctx;
    const td  = this._td;
    const W   = this.canvas.width;
    const H   = this.canvas.height;

    // Enemy path ribbon
    const wps = td.waypoints;
    if (wps.length >= 2) {
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // Shadow
      ctx.beginPath();
      ctx.moveTo(wps[0].x, wps[0].y);
      for (let i = 1; i < wps.length; i++) ctx.lineTo(wps[i].x, wps[i].y);
      ctx.strokeStyle = 'rgba(60,40,10,0.7)'; ctx.lineWidth = 36; ctx.stroke();
      // Road
      ctx.beginPath();
      ctx.moveTo(wps[0].x, wps[0].y);
      for (let i = 1; i < wps.length; i++) ctx.lineTo(wps[i].x, wps[i].y);
      ctx.strokeStyle = 'rgba(130,100,55,0.85)'; ctx.lineWidth = 26; ctx.stroke();
      // Start marker (green)
      ctx.beginPath(); ctx.arc(wps[0].x, wps[0].y, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#66ee66'; ctx.fill();
      // End marker (red)
      const last = wps[wps.length - 1];
      ctx.beginPath(); ctx.arc(last.x, last.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#ee4444'; ctx.fill();
      ctx.restore();
    }

    // Tower range rings (subtle)
    ctx.save();
    for (const t of td.towers) {
      ctx.beginPath(); ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(100,200,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle   = 'rgba(100,200,255,0.03)'; ctx.fill();
    }
    ctx.restore();

    // Tower entity sprites (drawn here so they appear above path)
    this.drawEntities();

    // Enemies
    ctx.save();
    for (const e of td.enemies) {
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fillStyle = e.color; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();
      // HP bar
      const bw = e.r * 2 + 6, bh = 4;
      const bx = e.x - bw / 2, by = e.y - e.r - 9;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = e.hp / e.maxHp > 0.4 ? '#44ee44' : '#ee4444';
      ctx.fillRect(bx, by, bw * (e.hp / e.maxHp), bh);
    }
    ctx.restore();

    // Tower projectiles
    ctx.save();
    for (const p of td.tdProjectiles) {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color; ctx.fill();
    }
    ctx.restore();

    // Next-wave countdown banner
    if (!td.waveActive && td.spawnQueue.length === 0 && !this.gameState.gameOver && !this.gameState.levelComplete) {
      const remaining = Math.ceil(td.waveDelay);
      if (remaining > 0 && remaining < 6) {
        ctx.save();
        ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(W / 2 - 110, 8, 220, 30);
        ctx.fillStyle = '#aaffcc';
        ctx.fillText(`Wave ${td.waveIndex + 1} in ${remaining}s`, W / 2, 29);
        ctx.restore();
      }
    }
  }

  // ── Match-3 Puzzle (Phase I) ───────────────────────────────────────────────

  _initMatch3() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const cols = this.level.m3Cols || 7;
    const rows = this.level.m3Rows || 7;
    const pad  = Math.round(Math.min(W, H) * 0.04);
    const cellW = Math.floor((W - pad * 2) / cols);
    const cellH = Math.floor((H - pad * 2 - 40) / rows);
    const cell  = Math.min(cellW, cellH);

    this._m3 = {
      cols, rows, cell, pad,
      offsetX: Math.round((W - cell * cols) / 2),
      offsetY: Math.round((H - cell * rows) / 2) + 20,
      grid: [],           // [row][col] = { color, type, matched }
      selected: null,     // { row, col }
      swapping: null,     // { r1,c1,r2,c2, t, dir } animation state
      falling: false,
      scoreMultiplier: 1,
      movesLeft: this.level.gameSettings?.moves ?? 30,
    };
    this._m3GenGrid();
    this.gameState.lives = this._m3.movesLeft;
    this._emitState();
  }

  _m3GenGrid() {
    const m  = this._m3;
    const COLORS = ['#e05050', '#50a0e0', '#50d050', '#e0c030', '#c050e0', '#e07030'];
    m.grid = [];
    for (let r = 0; r < m.rows; r++) {
      m.grid[r] = [];
      for (let c = 0; c < m.cols; c++) {
        let color;
        // Prevent starting matches
        do {
          color = COLORS[Math.floor(Math.random() * COLORS.length)];
        } while (
          (c >= 2 && m.grid[r][c-1]?.color === color && m.grid[r][c-2]?.color === color) ||
          (r >= 2 && m.grid[r-1]?.[c]?.color === color && m.grid[r-2]?.[c]?.color === color)
        );
        m.grid[r][c] = { color, matched: false };
      }
    }
  }

  _resetMatch3() {
    if (!this._m3) return;
    this._m3GenGrid();
    this._m3.selected = null;
    this._m3.swapping = null;
    this._m3.falling  = false;
    this._m3.movesLeft = this.level.gameSettings?.moves ?? 30;
    this.gameState.score = 0;
    this.gameState.lives = this._m3.movesLeft;
    this.gameState.gameOver      = false;
    this.gameState.levelComplete = false;
    this._emitState();
  }

  _updateMatch3(dt) {
    const m = this._m3;
    if (this.gameState.gameOver || this.gameState.levelComplete) return;

    // Animate swap
    if (m.swapping) {
      m.swapping.t += dt * 6;
      if (m.swapping.t >= 1) {
        const { r1, c1, r2, c2 } = m.swapping;
        // Perform actual swap
        const tmp = m.grid[r1][c1];
        m.grid[r1][c1] = m.grid[r2][c2];
        m.grid[r2][c2] = tmp;
        m.swapping = null;
        // Check for matches
        const matched = this._m3FindMatches();
        if (matched > 0) {
          this._m3ClearMatches();
          this.gameState.score += matched * 10 * m.scoreMultiplier;
          m.scoreMultiplier++;
          this._emitState();
          // Fall
          this._m3Fall();
        } else {
          // Swap back (no match)
          const tmp2 = m.grid[r1][c1];
          m.grid[r1][c1] = m.grid[r2][c2];
          m.grid[r2][c2] = tmp2;
          m.scoreMultiplier = 1;
        }
      }
      return;
    }

    // Process cascading falls
    if (m.falling) {
      const matched = this._m3FindMatches();
      if (matched > 0) {
        this._m3ClearMatches();
        this.gameState.score += matched * 10 * m.scoreMultiplier;
        m.scoreMultiplier++;
        this._emitState();
        this._m3Fall();
      } else {
        m.falling = false;
        m.scoreMultiplier = 1;
        if (m.movesLeft <= 0) {
          this.gameState.gameOver = true;
          this._emitState();
        }
      }
    }

    // Touch/click handled via _m3HandleClick called from EmbedRuntime canvas onClick
  }

  _m3FindMatches() {
    const m = this._m3;
    let count = 0;
    // Reset matched flags
    for (let r = 0; r < m.rows; r++)
      for (let c = 0; c < m.cols; c++)
        if (m.grid[r][c]) m.grid[r][c].matched = false;

    // Horizontal runs
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols - 2; c++) {
        const color = m.grid[r][c]?.color;
        if (!color) continue;
        if (m.grid[r][c+1]?.color === color && m.grid[r][c+2]?.color === color) {
          m.grid[r][c].matched = m.grid[r][c+1].matched = m.grid[r][c+2].matched = true;
        }
      }
    }
    // Vertical runs
    for (let c = 0; c < m.cols; c++) {
      for (let r = 0; r < m.rows - 2; r++) {
        const color = m.grid[r][c]?.color;
        if (!color) continue;
        if (m.grid[r+1]?.[c]?.color === color && m.grid[r+2]?.[c]?.color === color) {
          m.grid[r][c].matched = m.grid[r+1][c].matched = m.grid[r+2][c].matched = true;
        }
      }
    }
    for (let r = 0; r < m.rows; r++)
      for (let c = 0; c < m.cols; c++)
        if (m.grid[r]?.[c]?.matched) count++;
    return count;
  }

  _m3ClearMatches() {
    const m = this._m3;
    for (let r = 0; r < m.rows; r++)
      for (let c = 0; c < m.cols; c++)
        if (m.grid[r]?.[c]?.matched) m.grid[r][c] = null;
  }

  _m3Fall() {
    const m = this._m3;
    const COLORS = ['#e05050', '#50a0e0', '#50d050', '#e0c030', '#c050e0', '#e07030'];
    for (let c = 0; c < m.cols; c++) {
      // Compact nulls downward (row 0 = top)
      let write = m.rows - 1;
      for (let r = m.rows - 1; r >= 0; r--) {
        if (m.grid[r][c] !== null) { m.grid[write][c] = m.grid[r][c]; write--; }
      }
      for (let r = write; r >= 0; r--) {
        m.grid[r][c] = { color: COLORS[Math.floor(Math.random() * COLORS.length)], matched: false };
      }
    }
    m.falling = true;
  }

  // Called by canvas click/touch in EmbedRuntime and RuntimeView.
  m3HandleTap(clientX, clientY, canvasRect) {
    const m = this._m3;
    if (!m || this.gameState.gameOver || m.swapping) return;
    const scaleX = this.canvas.width  / canvasRect.width;
    const scaleY = this.canvas.height / canvasRect.height;
    const px = (clientX - canvasRect.left) * scaleX;
    const py = (clientY - canvasRect.top)  * scaleY;
    const col = Math.floor((px - m.offsetX) / m.cell);
    const row = Math.floor((py - m.offsetY) / m.cell);
    if (col < 0 || col >= m.cols || row < 0 || row >= m.rows) { m.selected = null; return; }

    if (!m.selected) {
      m.selected = { row, col };
      return;
    }
    const { row: r1, col: c1 } = m.selected;
    const dr = Math.abs(row - r1), dc = Math.abs(col - c1);
    if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
      // Adjacent — start swap animation
      m.swapping = { r1, c1, r2: row, c2: col, t: 0 };
      m.movesLeft--;
      this.gameState.lives = m.movesLeft;
      this._emitState();
    }
    m.selected = null;
  }

  _drawMatch3() {
    const ctx = this.ctx;
    const m   = this._m3;
    const W   = this.canvas.width;
    const H   = this.canvas.height;

    // Background
    ctx.fillStyle = '#0e1428';
    ctx.fillRect(0, 0, W, H);

    const cell = m.cell;
    const ox   = m.offsetX;
    const oy   = m.offsetY;
    const pad  = 3;

    // Grid cells
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        const tile = m.grid[r]?.[c];
        if (!tile) continue;
        const x = ox + c * cell + pad;
        const y = oy + r * cell + pad;
        const sz = cell - pad * 2;

        // Swap animation offset
        let dx = 0, dy = 0;
        if (m.swapping) {
          const t = Math.min(1, m.swapping.t);
          const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
          if (r === m.swapping.r1 && c === m.swapping.c1) {
            dx = (m.swapping.c2 - m.swapping.c1) * cell * ease;
            dy = (m.swapping.r2 - m.swapping.r1) * cell * ease;
          } else if (r === m.swapping.r2 && c === m.swapping.c2) {
            dx = (m.swapping.c1 - m.swapping.c2) * cell * ease;
            dy = (m.swapping.r1 - m.swapping.r2) * cell * ease;
          }
        }

        // Glow for selected
        const isSel = m.selected && m.selected.row === r && m.selected.col === c;
        const r2 = 6;
        ctx.save();
        ctx.translate(dx, dy);
        ctx.shadowColor = isSel ? '#ffffff' : 'transparent';
        ctx.shadowBlur  = isSel ? 12 : 0;
        ctx.fillStyle = tile.matched ? '#ffffff' : tile.color;
        ctx.beginPath();
        ctx.roundRect(x, y, sz, sz, r2);
        ctx.fill();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(x + 3, y + 3, sz - 6, sz * 0.4, r2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Moves left
    ctx.save();
    ctx.font = '14px monospace'; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(`Moves: ${m.movesLeft}`, 10, 20);
    ctx.restore();
  }

  // ── Card Games: Blackjack (Phase I) ─────────────────────────────────────────

  _initBlackjack() {
    const level  = this.level;
    const preset = level.gameSettings || {};
    this._bj = {
      deck: [], playerHand: [], dealerHand: [],
      phase: 'betting',
      balance:  preset.startBalance ?? 1000,
      bet:      preset.startBet     ?? 50,
      result:   null,
      inputCooldown: 0,
      _prevAttack: false, _prevJump: false, _prevInteract: false,
      _prevLeft: false,   _prevRight: false,
    };
    this._bjNewDeck();
    this.gameState.score = this._bj.balance;
    this._emitState();
  }

  _bjNewDeck() {
    const suits = ['♠', '♣', '♥', '♦'];
    const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    const deck  = [];
    for (const suit of suits)
      for (const rank of ranks)
        deck.push({ suit, rank, red: suit === '♥' || suit === '♦' });
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    this._bj.deck = deck;
  }

  _bjCardValue(card) {
    if (card.rank === 'A') return 11;
    if (['J','Q','K'].includes(card.rank)) return 10;
    return parseInt(card.rank, 10);
  }

  _bjHandValue(hand) {
    let total = 0, aces = 0;
    for (const c of hand) {
      if (c.hidden) continue;
      if (c.rank === 'A') aces++;
      total += this._bjCardValue(c);
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
  }

  _bjDraw() {
    if (this._bj.deck.length < 10) this._bjNewDeck();
    return this._bj.deck.pop();
  }

  _bjDeal() {
    const bj = this._bj;
    if (bj.bet > bj.balance) bj.bet = bj.balance;
    bj.playerHand = [this._bjDraw(), this._bjDraw()];
    bj.dealerHand = [this._bjDraw(), { ...this._bjDraw(), hidden: true }];
    bj.phase  = 'playing';
    bj.result = null;
    // Natural blackjack check
    const pv = this._bjHandValue(bj.playerHand);
    if (pv === 21) {
      bj.dealerHand.forEach(c => { c.hidden = false; });
      const dv = this._bjHandValue(bj.dealerHand);
      if (dv === 21) { bj.result = 'push'; }
      else           { bj.balance += Math.round(bj.bet * 1.5); bj.result = 'blackjack'; }
      bj.phase = 'result';
      this.gameState.score = bj.balance;
      this._emitState();
    }
  }

  _bjHit() {
    const bj = this._bj;
    bj.playerHand.push(this._bjDraw());
    if (this._bjHandValue(bj.playerHand) > 21) {
      bj.result = 'bust';
      bj.balance -= bj.bet;
      bj.phase   = 'result';
      this.gameState.score = bj.balance;
      if (bj.balance <= 0) this.gameState.gameOver = true;
      this._emitState();
    }
  }

  _bjStand() {
    const bj = this._bj;
    bj.dealerHand.forEach(c => { c.hidden = false; });
    while (this._bjHandValue(bj.dealerHand) < 17) bj.dealerHand.push(this._bjDraw());
    const pv = this._bjHandValue(bj.playerHand);
    const dv = this._bjHandValue(bj.dealerHand);
    if (dv > 21 || pv > dv)      { bj.result = 'win';  bj.balance += bj.bet; }
    else if (pv < dv)             { bj.result = 'lose'; bj.balance -= bj.bet; }
    else                          { bj.result = 'push'; }
    bj.phase = 'result';
    this.gameState.score = bj.balance;
    if (bj.balance <= 0) this.gameState.gameOver = true;
    this._emitState();
  }

  _resetBlackjack() {
    if (!this._bj) return;
    const preset = this.level.gameSettings || {};
    this._bj.balance  = preset.startBalance ?? 1000;
    this._bj.bet      = preset.startBet     ?? 50;
    this._bj.phase    = 'betting';
    this._bj.result   = null;
    this._bj.playerHand = [];
    this._bj.dealerHand = [];
    this._bjNewDeck();
    this.gameState.score = this._bj.balance;
    this.gameState.gameOver      = false;
    this.gameState.levelComplete = false;
    this._emitState();
  }

  _updateBlackjack(dt) {
    const bj = this._bj;
    if (this.gameState.gameOver) return;
    bj.inputCooldown = Math.max(0, bj.inputCooldown - dt);

    const hitEdge     = this.input.attack  && !bj._prevAttack;
    const standEdge   = this.input.jump    && !bj._prevJump;
    const dealEdge    = this.input.interact && !bj._prevInteract;
    const leftEdge    = this.input.left    && !bj._prevLeft;
    const rightEdge   = this.input.right   && !bj._prevRight;
    bj._prevAttack  = this.input.attack;
    bj._prevJump    = this.input.jump;
    bj._prevInteract = this.input.interact;
    bj._prevLeft    = this.input.left;
    bj._prevRight   = this.input.right;

    if (bj.inputCooldown > 0) return;

    if (bj.phase === 'betting') {
      if (leftEdge)  { bj.bet = Math.max(10, bj.bet - 10); }
      if (rightEdge) { bj.bet = Math.min(bj.balance, bj.bet + 10); }
      if (dealEdge)  { this._bjDeal(); bj.inputCooldown = 0.25; }
    } else if (bj.phase === 'playing') {
      if (hitEdge)   { this._bjHit();   bj.inputCooldown = 0.25; }
      if (standEdge) { this._bjStand(); bj.inputCooldown = 0.25; }
    } else if (bj.phase === 'result') {
      if (dealEdge)  { bj.phase = 'betting'; bj.inputCooldown = 0.25; }
    }
  }

  _drawBlackjack() {
    const ctx = this.ctx;
    const bj  = this._bj;
    const W   = this.canvas.width;
    const H   = this.canvas.height;

    // Felt background
    ctx.fillStyle = '#1c4a2c'; ctx.fillRect(0, 0, W, H);
    // Oval table suggestion
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2, W * 0.46, H * 0.44, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();

    // Title
    ctx.save();
    ctx.font = 'bold 15px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#f0d080';
    ctx.fillText('BLACKJACK', W / 2, 22);
    ctx.restore();

    const cardW = Math.round(Math.min(W * 0.13, 68));
    const cardH = Math.round(cardW * 1.46);
    const gap   = Math.round(cardW * 0.22);

    this._bjDrawHand(bj.dealerHand, W / 2, Math.round(H * 0.28), cardW, cardH, gap, 'Dealer');
    this._bjDrawHand(bj.playerHand, W / 2, Math.round(H * 0.66), cardW, cardH, gap, 'You');

    // Balance & bet
    ctx.save();
    ctx.font = '12px monospace'; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`$${bj.balance}`, 10, H - 28);
    ctx.fillStyle = '#f0d080';
    ctx.fillText(`Bet: $${bj.bet}`, 10, H - 12);
    ctx.restore();

    // Phase controls hint
    ctx.save();
    ctx.font = '11px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(200,255,200,0.75)';
    if (bj.phase === 'betting') {
      ctx.fillText('[←/→] Bet   [E] Deal', W / 2, H - 10);
    } else if (bj.phase === 'playing') {
      ctx.fillText('[Z] Hit   [Space] Stand', W / 2, H - 10);
    } else if (bj.phase === 'result') {
      const clr   = { win:'#88ff88', lose:'#ff6666', push:'#ffff66', bust:'#ff9944', blackjack:'#ffdd44' };
      const label = { win:'YOU WIN!', lose:'YOU LOSE', push:'PUSH', bust:'BUST!', blackjack:'BLACKJACK!' };
      ctx.font = 'bold 22px monospace'; ctx.fillStyle = clr[bj.result] || '#ffffff';
      ctx.fillText(label[bj.result] || '', W / 2, H * 0.5);
      ctx.font = '11px monospace'; ctx.fillStyle = 'rgba(200,255,200,0.75)';
      ctx.fillText('[E] New hand', W / 2, H - 10);
    }
    ctx.restore();
  }

  _bjDrawHand(hand, cx, cy, cardW, cardH, gap, label) {
    if (!hand.length) return;
    const ctx    = this.ctx;
    const totalW = hand.length * cardW + (hand.length - 1) * gap;
    const startX = cx - totalW / 2;
    const value  = this._bjHandValue(hand);

    // Label
    ctx.save();
    ctx.font = '11px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`${label} — ${hand.some(c => c.hidden) ? '?' : value}`, cx, cy - cardH / 2 - 8);
    ctx.restore();

    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      const x    = startX + i * (cardW + gap);
      const y    = cy - cardH / 2;
      ctx.save();
      // Shadow
      ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 3;
      ctx.fillStyle    = card.hidden ? '#1a3a8a' : '#f8f4ee';
      ctx.strokeStyle  = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x, y, cardW, cardH, 5); ctx.fill(); ctx.stroke();
      ctx.shadowColor  = 'transparent';
      if (!card.hidden) {
        const fs = Math.round(cardW * 0.26);
        ctx.font = `bold ${fs}px monospace`;
        ctx.fillStyle = card.red ? '#cc1111' : '#111111';
        ctx.textAlign = 'left';
        ctx.fillText(card.rank, x + 4, y + fs + 2);
        ctx.fillText(card.suit, x + 4, y + fs * 2 + 2);
        ctx.textAlign = 'right';
        ctx.fillText(card.rank, x + cardW - 4, y + cardH - 4);
      } else {
        // Card back — simple stripe pattern
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        for (let s = 0; s < 6; s++) {
          ctx.fillRect(x + 5 + s * (cardW - 10) / 6, y + 5, (cardW - 10) / 8, cardH - 10);
        }
      }
      ctx.restore();
    }
  }

  // ── Card Games: Solitaire / Klondike (Phase I) ────────────────────────────

  _initSolitaire() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    this._sol = this._solBuild(W, H);
    this.gameState.score = 0;
    this._emitState();
  }

  _solBuild(W, H) {
    const suits  = ['♠', '♣', '♥', '♦'];
    const ranks  = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    const deck   = [];
    for (const suit of suits)
      for (const rank of ranks)
        deck.push({ suit, rank, red: suit === '♥' || suit === '♦', faceUp: false });
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    // Tableau: 7 columns, 1–7 cards each, top card face up
    const tableau = [];
    let di = 0;
    for (let c = 0; c < 7; c++) {
      const col = [];
      for (let r = 0; r <= c; r++) {
        const card = { ...deck[di++] };
        if (r === c) card.faceUp = true;
        col.push(card);
      }
      tableau.push(col);
    }

    // Stock: remaining cards
    const stock = deck.slice(di).map(c => ({ ...c, faceUp: false }));

    // Cell dimensions
    const pad   = Math.round(W * 0.03);
    const cw    = Math.round((W - pad * 2) / 7 - 4);
    const ch    = Math.round(cw * 1.44);

    return {
      tableau,
      stock,
      waste:       [],   // flipped cards from stock
      foundation:  [[], [], [], []],  // 4 foundation piles (A→K per suit)
      selected:    null, // { pile: 'tableau'|'waste', colIdx, cardIdx }
      stockOffset: 0,
      cardW: cw, cardH: ch, pad,
      offsetY: Math.round(H * 0.12),
    };
  }

  _resetSolitaire() {
    if (!this._sol) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    this._sol = this._solBuild(W, H);
    this.gameState.score = 0;
    this.gameState.gameOver      = false;
    this.gameState.levelComplete = false;
    this._emitState();
  }

  _updateSolitaire(dt) {
    // Input via solHandleTap (click/touch)
  }

  // Public: called by canvas onClick in EmbedRuntime/RuntimeView.
  solHandleTap(clientX, clientY, canvasRect) {
    const sol = this._sol;
    if (!sol || this.gameState.levelComplete) return;
    const scaleX = this.canvas.width  / canvasRect.width;
    const scaleY = this.canvas.height / canvasRect.height;
    const px = (clientX - canvasRect.left) * scaleX;
    const py = (clientY - canvasRect.top)  * scaleY;
    const { cardW: cw, cardH: ch, pad, offsetY } = sol;
    const colSpacing = (this.canvas.width - pad * 2) / 7;

    // Check stock click
    const stockX = pad, stockY = pad;
    if (px >= stockX && px <= stockX + cw && py >= stockY && py <= stockY + ch) {
      if (sol.stock.length > 0) {
        const card = sol.stock.pop();
        card.faceUp = true;
        sol.waste.push(card);
      } else {
        // Recycle waste back to stock
        sol.waste.reverse().forEach(c => { c.faceUp = false; sol.stock.push(c); });
        sol.waste = [];
      }
      sol.selected = null;
      return;
    }

    // Check waste top
    const wasteX = pad + colSpacing;
    if (sol.waste.length && px >= wasteX && px <= wasteX + cw && py >= stockY && py <= stockY + ch) {
      if (sol.selected?.pile === 'waste') { sol.selected = null; }
      else { sol.selected = { pile: 'waste', cardIdx: sol.waste.length - 1 }; }
      return;
    }

    // Check foundation piles
    for (let f = 0; f < 4; f++) {
      const fx = pad + (f + 3) * colSpacing;
      if (px >= fx && px <= fx + cw && py >= stockY && py <= stockY + ch) {
        if (sol.selected) this._solMoveToFoundation(f, sol.selected);
        else {
          const pile = sol.foundation[f];
          if (pile.length) sol.selected = { pile: 'foundation', colIdx: f, cardIdx: pile.length - 1 };
        }
        return;
      }
    }

    // Check tableau columns
    for (let c = 0; c < 7; c++) {
      const tx    = pad + c * colSpacing;
      const col   = sol.tableau[c];
      const colH  = col.length === 0 ? ch : (col.length - 1) * Math.round(ch * 0.25) + ch;
      if (px < tx || px > tx + cw || py < offsetY || py > offsetY + colH) continue;

      // Find which card was tapped
      const overlap = Math.round(ch * 0.25);
      let tappedIdx = col.length - 1;
      for (let i = 0; i < col.length - 1; i++) {
        const cy = offsetY + i * overlap;
        if (py >= cy && py < cy + overlap) { tappedIdx = i; break; }
      }
      if (!col[tappedIdx]?.faceUp) {
        // Flip top card
        if (tappedIdx === col.length - 1) col[tappedIdx].faceUp = true;
        sol.selected = null;
        return;
      }
      if (sol.selected) {
        this._solMoveToTableau(c, tappedIdx, sol.selected);
      } else {
        sol.selected = { pile: 'tableau', colIdx: c, cardIdx: tappedIdx };
      }
      return;
    }
    sol.selected = null;
  }

  _solCardOrder(rank) {
    return ['A','2','3','4','5','6','7','8','9','10','J','Q','K'].indexOf(rank);
  }

  _solMoveToFoundation(fIdx, sel) {
    const sol  = this._sol;
    const card = this._solGetCard(sel);
    if (!card) { sol.selected = null; return; }
    const pile = sol.foundation[fIdx];
    const top  = pile[pile.length - 1];
    const valid = (!top && card.rank === 'A') ||
                  (top && top.suit === card.suit && this._solCardOrder(card.rank) === this._solCardOrder(top.rank) + 1);
    if (!valid) { sol.selected = null; return; }

    this._solRemoveCard(sel);
    pile.push(card);
    sol.selected = null;
    this.gameState.score += 10;
    // Win check
    if (sol.foundation.every(f => f.length === 13)) {
      this.gameState.levelComplete = true;
    }
    this._emitState();
  }

  _solMoveToTableau(colIdx, toCardIdx, sel) {
    const sol   = this._sol;
    const col   = sol.tableau[colIdx];
    // Collect cards to move (sel.cardIdx and below)
    const cards = this._solGetCards(sel);
    if (!cards || cards.length === 0) { sol.selected = null; return; }
    const movingCard = cards[0];
    const target     = col.length > 0 ? col[col.length - 1] : null;

    const valid = (!target && movingCard.rank === 'K') ||
                  (target && target.faceUp && target.red !== movingCard.red &&
                   this._solCardOrder(movingCard.rank) === this._solCardOrder(target.rank) - 1);
    if (!valid) { sol.selected = null; return; }

    this._solRemoveCards(sel);
    cards.forEach(c => col.push(c));
    sol.selected = null;
    this.gameState.score += 5;
    this._emitState();
  }

  _solGetCard(sel) {
    const sol = this._sol;
    if (sel.pile === 'waste')      return sol.waste[sel.cardIdx];
    if (sel.pile === 'foundation') return sol.foundation[sel.colIdx][sel.cardIdx];
    if (sel.pile === 'tableau')    return sol.tableau[sel.colIdx][sel.cardIdx];
    return null;
  }

  _solGetCards(sel) {
    const sol = this._sol;
    if (sel.pile === 'waste')   return [sol.waste[sol.waste.length - 1]];
    if (sel.pile === 'tableau') return sol.tableau[sel.colIdx].slice(sel.cardIdx);
    return null;
  }

  _solRemoveCard(sel) {
    const sol = this._sol;
    if (sel.pile === 'waste')      { sol.waste.pop(); }
    else if (sel.pile === 'foundation') { sol.foundation[sel.colIdx].pop(); }
    else if (sel.pile === 'tableau')    {
      sol.tableau[sel.colIdx].splice(sel.cardIdx, 1);
      const col = sol.tableau[sel.colIdx];
      if (col.length && !col[col.length - 1].faceUp) col[col.length - 1].faceUp = true;
    }
    sol.selected = null;
  }

  _solRemoveCards(sel) {
    const sol = this._sol;
    if (sel.pile === 'tableau') {
      sol.tableau[sel.colIdx].splice(sel.cardIdx);
      const col = sol.tableau[sel.colIdx];
      if (col.length && !col[col.length - 1].faceUp) col[col.length - 1].faceUp = true;
    } else {
      this._solRemoveCard(sel);
    }
    sol.selected = null;
  }

  // ── Fighting: 1v1 Brawler (Phase I) ──────────────────────────────────────

  _initFighting() {
    const W   = this.canvas.width;
    const H   = this.canvas.height;
    const gs  = this.level.gameSettings || {};
    const gravity = 1200;
    const floor   = Math.round(H * 0.80);

    const makefighter = (x, facing, isPlayer) => ({
      x, y: floor,
      w: 36, h: 56,
      vx: 0, vy: 0,
      onGround: true,
      facing,
      hp: gs.hp ?? 100,
      maxHp: gs.hp ?? 100,
      blocking: false,
      attackCooldown: 0,
      attackActive: 0,     // time remaining on active hitbox
      hitStun: 0,          // time remaining in hit-stun
      knockback: 0,
      isPlayer,
      aiTimer: 0,
      roundWins: 0,
      color: isPlayer ? '#4488ff' : '#ff4444',
    });

    this._fg = {
      p1: makefighter(Math.round(W * 0.28), 'right', true),
      p2: makefighter(Math.round(W * 0.72), 'left',  false),
      gravity,
      floor,
      roundTimer: gs.timerSeconds ?? 60,
      maxRounds:  gs.rounds ?? 3,
      round:      1,
      phase:      'countdown', // countdown | fight | roundEnd | gameEnd
      phaseTimer: 2,
      result:     null,   // 'p1' | 'p2' | 'draw'
      _prevAttack: false, _prevJump: false, _prevBlock: false,
    };
    this.gameState.timer = gs.timerSeconds ?? 60;
    this.gameState.timerRunning = false;
    this._emitState();
  }

  _resetFighting() {
    if (!this._fg) return;
    const W  = this.canvas.width;
    const H  = this.canvas.height;
    const gs = this.level.gameSettings || {};
    const fg = this._fg;
    fg.p1.x = Math.round(W * 0.28); fg.p1.y = fg.floor; fg.p1.vx = fg.p1.vy = 0;
    fg.p1.hp = fg.p1.maxHp; fg.p1.attackCooldown = 0; fg.p1.hitStun = 0; fg.p1.facing = 'right';
    fg.p2.x = Math.round(W * 0.72); fg.p2.y = fg.floor; fg.p2.vx = fg.p2.vy = 0;
    fg.p2.hp = fg.p2.maxHp; fg.p2.attackCooldown = 0; fg.p2.hitStun = 0; fg.p2.facing = 'left';
    fg.p1.roundWins = 0; fg.p2.roundWins = 0;
    fg.roundTimer = gs.timerSeconds ?? 60;
    fg.round = 1; fg.phase = 'countdown'; fg.phaseTimer = 2; fg.result = null;
    this.gameState.timer = gs.timerSeconds ?? 60;
    this.gameState.gameOver = false; this.gameState.levelComplete = false;
    this._emitState();
  }

  _fgFighterUpdate(f, opp, isPlayer, dt, input) {
    const fg = this._fg;
    const W  = this.canvas.width;
    // Movement
    if (f.hitStun <= 0 && !f.blocking) {
      const speed = 220;
      if (input.left)  { f.vx = -speed; f.facing = 'left'; }
      else if (input.right) { f.vx =  speed; f.facing = 'right'; }
      else f.vx *= 0.75;
    } else {
      f.vx *= 0.55;
    }

    // Jump
    if (input.jump && f.onGround && f.hitStun <= 0) {
      f.vy   = -680;
      f.onGround = false;
    }

    // Block
    f.blocking = input.down && f.onGround && f.hitStun <= 0;

    // Gravity + floor
    f.vy += fg.gravity * dt;
    f.x  += f.vx * dt;
    f.y  += f.vy * dt;
    if (f.y >= fg.floor) { f.y = fg.floor; f.vy = 0; f.onGround = true; }
    // Clamp to screen
    f.x = Math.max(20, Math.min(W - 20, f.x));

    // Attack (Z key or jump+attack = special)
    f.attackCooldown = Math.max(0, f.attackCooldown - dt);
    f.attackActive   = Math.max(0, f.attackActive   - dt);
    f.hitStun        = Math.max(0, f.hitStun         - dt);

    if (input.attack && f.attackCooldown <= 0 && f.hitStun <= 0) {
      f.attackActive   = 0.12;
      f.attackCooldown = 0.45;
    }

    // Apply knockback decay
    f.knockback *= Math.pow(0.8, dt * 60);

    // Face opponent
    if (f.hitStun <= 0) f.facing = f.x < opp.x ? 'right' : 'left';

    // Check if attack hitbox connects
    if (f.attackActive > 0) {
      const range = 55;
      const dir   = f.facing === 'right' ? 1 : -1;
      const hitX  = f.x + dir * (f.w / 2 + range);
      const inRange = Math.abs(hitX - opp.x) < 40 && Math.abs(f.y - opp.y) < 60;
      if (inRange) {
        const dmg = opp.blocking ? 5 : 18;
        opp.hp = Math.max(0, opp.hp - dmg);
        opp.hitStun = opp.blocking ? 0.1 : 0.35;
        opp.vx = dir * (opp.blocking ? 80 : 200);
        this.gameState.flashScreen = 0.12;
        f.attackActive = 0;  // one hit per swing
        this._emitState();
      }
    }
  }

  _fgAiInput(ai, player, dt) {
    const fg  = this._fg;
    ai.aiTimer -= dt;
    if (ai.aiTimer > 0) return ai._lastInput || {};
    ai.aiTimer = 0.2 + Math.random() * 0.25;

    const dx   = player.x - ai.x;
    const dist = Math.abs(dx);
    const inp  = { left: false, right: false, up: false, down: false, jump: false, attack: false };
    if (dist > 70) {
      inp[dx > 0 ? 'right' : 'left'] = true;
    } else {
      inp.attack = Math.random() < 0.6;
      inp.down   = Math.random() < 0.2;  // block
    }
    if (Math.random() < 0.08 && ai.onGround) inp.jump = true;
    ai._lastInput = inp;
    return inp;
  }

  _updateFighting(dt) {
    const fg = this._fg;
    if (this.gameState.gameOver || this.gameState.levelComplete) return;

    if (fg.phase === 'countdown') {
      fg.phaseTimer -= dt;
      if (fg.phaseTimer <= 0) {
        fg.phase = 'fight';
        fg.phaseTimer = fg.roundTimer;
        this.gameState.timerRunning = true;
      }
      return;
    }

    if (fg.phase === 'roundEnd' || fg.phase === 'gameEnd') {
      fg.phaseTimer -= dt;
      if (fg.phaseTimer <= 0 && fg.phase !== 'gameEnd') {
        this._fgStartNextRound();
      }
      return;
    }

    // Fight phase
    fg.phaseTimer -= dt;
    this.gameState.timer = Math.max(0, fg.phaseTimer);

    // Player input
    const p1Input = {
      left: this.input.left, right: this.input.right,
      jump: this.input.jump, down: this.input.down, attack: this.input.attack,
    };
    const p2Input = this._fgAiInput(fg.p2, fg.p1, dt);

    this._fgFighterUpdate(fg.p1, fg.p2, true,  dt, p1Input);
    this._fgFighterUpdate(fg.p2, fg.p1, false, dt, p2Input);

    if (this.gameState.flashScreen > 0) this.gameState.flashScreen = Math.max(0, this.gameState.flashScreen - dt);

    // Round end conditions
    const p1Dead = fg.p1.hp <= 0;
    const p2Dead = fg.p2.hp <= 0;
    const timUp  = fg.phaseTimer <= 0;
    if (p1Dead || p2Dead || timUp) {
      if (p1Dead && !p2Dead) { fg.result = 'p2'; fg.p2.roundWins++; }
      else if (p2Dead && !p1Dead) { fg.result = 'p1'; fg.p1.roundWins++; }
      else { fg.result = 'draw'; }
      this.gameState.score = fg.p1.roundWins;
      fg.phase = 'roundEnd';
      fg.phaseTimer = 2.5;
      // Check match end
      const wins = Math.ceil(fg.maxRounds / 2);
      if (fg.p1.roundWins >= wins || fg.p2.roundWins >= wins || fg.round >= fg.maxRounds) {
        fg.phase = 'gameEnd';
        if (fg.p1.roundWins > fg.p2.roundWins) this.gameState.levelComplete = true;
        else this.gameState.gameOver = true;
      }
      this._emitState();
    }
  }

  _fgStartNextRound() {
    const fg  = this._fg;
    const W   = this.canvas.width;
    const gs  = this.level.gameSettings || {};
    fg.round++;
    fg.p1.x = Math.round(W * 0.28); fg.p1.y = fg.floor; fg.p1.vx = fg.p1.vy = 0;
    fg.p1.hp = fg.p1.maxHp; fg.p1.attackCooldown = 0; fg.p1.hitStun = 0;
    fg.p2.x = Math.round(W * 0.72); fg.p2.y = fg.floor; fg.p2.vx = fg.p2.vy = 0;
    fg.p2.hp = fg.p2.maxHp; fg.p2.attackCooldown = 0; fg.p2.hitStun = 0;
    fg.roundTimer = gs.timerSeconds ?? 60;
    fg.phase = 'countdown'; fg.phaseTimer = 2; fg.result = null;
    this.gameState.timer = fg.roundTimer;
  }

  _drawFighting() {
    const ctx = this.ctx;
    const fg  = this._fg;
    const W   = this.canvas.width;
    const H   = this.canvas.height;

    // Background
    ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, W, H);
    // Stage floor
    ctx.fillStyle = '#333a55';
    ctx.fillRect(0, fg.floor + 4, W, H - fg.floor);
    ctx.fillStyle = '#44537a';
    ctx.fillRect(0, fg.floor + 4, W, 4);

    // Health bars
    const hbW = W * 0.38, hbH = 16, hbY = 14;
    const drawHP = (f, lx, label) => {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(lx, hbY, hbW, hbH);
      const pct = f.hp / f.maxHp;
      ctx.fillStyle = pct > 0.5 ? '#44dd44' : pct > 0.2 ? '#ddaa22' : '#dd2222';
      ctx.fillRect(lx, hbY, hbW * pct, hbH);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(lx, hbY, hbW, hbH);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
      ctx.fillText(label, lx + hbW / 2, hbY + 12);
    };
    drawHP(fg.p1, W * 0.04, 'P1');
    drawHP(fg.p2, W * 0.58, 'CPU');

    // Round wins
    ctx.save();
    ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = '#ffdd44';
    ctx.fillText(`Round ${fg.round}/${fg.maxRounds}  |  ${fg.p1.roundWins}–${fg.p2.roundWins}`, W / 2, 12);
    const t = Math.ceil(this.gameState.timer);
    ctx.fillStyle = t < 10 ? '#ff6666' : '#ffffff';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(t, W / 2, 36);
    ctx.restore();

    // Draw fighters
    const drawFighter = (f) => {
      ctx.save();
      const isHit = f.hitStun > 0;
      ctx.globalAlpha = isHit && Math.floor(this.time * 12) % 2 === 0 ? 0.5 : 1;
      // Body
      ctx.fillStyle = f.blocking ? '#888' : f.color;
      ctx.fillRect(f.x - f.w / 2, f.y - f.h, f.w, f.h);
      // Head
      ctx.beginPath(); ctx.arc(f.x, f.y - f.h - 14, 13, 0, Math.PI * 2);
      ctx.fillStyle = f.blocking ? '#888' : f.color; ctx.fill();
      // Eyes
      const eyeOff = f.facing === 'right' ? 4 : -4;
      ctx.fillStyle = '#fff';
      ctx.fillRect(f.x + eyeOff - 3, f.y - f.h - 18, 5, 5);
      // Attack flash
      if (f.attackActive > 0) {
        const dir = f.facing === 'right' ? 1 : -1;
        ctx.fillStyle = 'rgba(255,255,100,0.7)';
        ctx.fillRect(f.x + dir * (f.w / 2), f.y - f.h * 0.6, dir * 50, 20);
      }
      ctx.restore();
    };
    drawFighter(fg.p1);
    drawFighter(fg.p2);

    // Phase overlays
    if (fg.phase === 'countdown') {
      const sec = Math.ceil(fg.phaseTimer);
      ctx.save(); ctx.font = 'bold 48px monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(W / 2 - 80, H / 2 - 50, 160, 70);
      ctx.fillStyle = '#ffdd44';
      ctx.fillText(sec > 0 ? String(sec) : 'FIGHT!', W / 2, H / 2 + 10);
      ctx.restore();
    } else if (fg.phase === 'roundEnd' || fg.phase === 'gameEnd') {
      ctx.save(); ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(W / 2 - 120, H / 2 - 40, 240, 60);
      ctx.fillStyle = '#ffdd44';
      const label = fg.result === 'p1' ? 'P1 WINS!' : fg.result === 'p2' ? 'CPU WINS!' : 'DRAW!';
      ctx.fillText(label, W / 2, H / 2 + 6);
      ctx.restore();
    }

    // Controls hint
    ctx.save();
    ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('[←/→] Move  [Space] Jump  [Z] Punch  [↓] Block', W / 2, H - 8);
    ctx.restore();

    if (this.gameState.flashScreen > 0) {
      const a = Math.min(0.5, this.gameState.flashScreen * 1.5);
      ctx.fillStyle = `rgba(255,200,60,${a})`; ctx.fillRect(0, 0, W, H);
    }
  }

  // ── Rhythm: Lane Tap / Guitar Hero (Phase I) ─────────────────────────────

  _initRhythm() {
    const W   = this.canvas.width;
    const H   = this.canvas.height;
    const gs  = this.level.gameSettings || {};
    const numLanes = gs.lanes ?? 4;
    const bpm = gs.bpm   ?? 120;

    this._rh = {
      numLanes,
      bpm,
      beatInterval: 60 / bpm,    // seconds per beat
      beatTimer:    0,
      notes:        [],           // { lane, y, hit, miss }
      hits:         0,
      misses:       0,
      combo:        0,
      maxCombo:     0,
      laneHeld:     Array(numLanes).fill(false),
      laneFlash:    Array(numLanes).fill(0),
      targetY:      Math.round(H * 0.82),    // hit zone Y
      hitWindow:    55,           // ± px window for a hit
      noteSpeed:    Math.round(H * 0.55),    // px/s (note falls this fast)
      laneKeys:     ['left', 'up', 'right', 'down'].slice(0, numLanes),
      laneColors:   ['#e05050', '#50c0e0', '#50e050', '#e0c030'],
      lives:        gs.lives ?? 5,
      songDuration: gs.songDuration ?? 60,
      songTimer:    0,
      // Auto-generated note chart — no audio sync, just beat patterns
      chart:        this._rhGenChart(bpm, gs.songDuration ?? 60),
      chartIdx:     0,
    };
    this.gameState.lives = this._rh.lives;
    this.gameState.score = 0;
    this._emitState();
  }

  _rhGenChart(bpm, duration) {
    // Generate a simple note chart: quarter notes across random lanes
    const beatInterval = 60 / bpm;
    const chart = [];
    for (let t = 0.5; t < duration - 1; t += beatInterval) {
      chart.push({ time: t, lane: Math.floor(Math.random() * 4) });
      // Occasionally add a simultaneous second note
      if (Math.random() < 0.2) {
        let lane2;
        do { lane2 = Math.floor(Math.random() * 4); } while (lane2 === chart[chart.length - 1].lane);
        chart.push({ time: t, lane: lane2 });
      }
    }
    return chart;
  }

  _resetRhythm() {
    if (!this._rh) return;
    const gs = this.level.gameSettings || {};
    this._rh.notes    = [];
    this._rh.hits     = 0;
    this._rh.misses   = 0;
    this._rh.combo    = 0;
    this._rh.maxCombo = 0;
    this._rh.laneHeld = Array(this._rh.numLanes).fill(false);
    this._rh.laneFlash = Array(this._rh.numLanes).fill(0);
    this._rh.lives    = gs.lives ?? 5;
    this._rh.songTimer = 0;
    this._rh.chart    = this._rhGenChart(this._rh.bpm, gs.songDuration ?? 60);
    this._rh.chartIdx = 0;
    this.gameState.score = 0;
    this.gameState.lives = this._rh.lives;
    this.gameState.gameOver      = false;
    this.gameState.levelComplete = false;
    this._emitState();
  }

  _updateRhythm(dt) {
    const rh = this._rh;
    if (this.gameState.gameOver || this.gameState.levelComplete) return;

    rh.songTimer += dt;

    // Spawn notes from chart
    while (rh.chartIdx < rh.chart.length) {
      const entry = rh.chart[rh.chartIdx];
      const spawnTime = entry.time - (rh.targetY / rh.noteSpeed);
      if (rh.songTimer >= spawnTime) {
        rh.notes.push({ lane: entry.lane, y: 0, hit: false, miss: false, flash: 0 });
        rh.chartIdx++;
      } else break;
    }

    // Song end
    if (rh.songTimer >= rh.songDuration && rh.notes.length === 0) {
      this.gameState.levelComplete = true;
      this._emitState();
      return;
    }

    // Move notes
    for (const n of rh.notes) { n.y += rh.noteSpeed * dt; if (n.flash > 0) n.flash -= dt; }

    // Miss notes that passed the window
    for (let i = rh.notes.length - 1; i >= 0; i--) {
      const n = rh.notes[i];
      if (n.y > rh.targetY + rh.hitWindow && !n.hit) {
        n.miss = true;
        rh.misses++;
        rh.combo = 0;
        rh.lives--;
        this.gameState.lives = rh.lives;
        this.gameState.flashScreen = 0.2;
        if (rh.lives <= 0) this.gameState.gameOver = true;
        this._emitState();
      }
      if (n.miss || (n.hit && n.flash <= 0)) rh.notes.splice(i, 1);
    }

    // Lane flash decay
    rh.laneFlash = rh.laneFlash.map(f => Math.max(0, f - dt));

    // Input: check each lane key for edge-down
    const laneKeys = rh.laneKeys;
    for (let l = 0; l < rh.numLanes; l++) {
      const down = this.input[laneKeys[l]];
      const edge = down && !rh.laneHeld[l];
      rh.laneHeld[l] = down;
      if (!edge) continue;

      rh.laneFlash[l] = 0.12;
      // Find closest note in this lane within hit window
      let best = null, bestDist = Infinity;
      for (const n of rh.notes) {
        if (n.lane !== l || n.hit || n.miss) continue;
        const d = Math.abs(n.y - rh.targetY);
        if (d < rh.hitWindow && d < bestDist) { best = n; bestDist = d; }
      }
      if (best) {
        best.hit   = true;
        best.flash = 0.25;
        rh.hits++;
        rh.combo++;
        if (rh.combo > rh.maxCombo) rh.maxCombo = rh.combo;
        const points = bestDist < 20 ? 300 : bestDist < 35 ? 150 : 50;
        this.gameState.score += points * Math.min(rh.combo, 8);
        this._emitState();
      }
    }

    if (this.gameState.flashScreen > 0) this.gameState.flashScreen = Math.max(0, this.gameState.flashScreen - dt);
  }

  _drawRhythm() {
    const ctx = this.ctx;
    const rh  = this._rh;
    const W   = this.canvas.width;
    const H   = this.canvas.height;

    // Background
    ctx.fillStyle = '#0d0d1a'; ctx.fillRect(0, 0, W, H);

    const laneW  = Math.round(W * 0.6 / rh.numLanes);
    const startX = Math.round((W - laneW * rh.numLanes) / 2);
    const noteR  = Math.round(laneW * 0.36);
    const targetY = rh.targetY;

    // Lane tracks
    for (let l = 0; l < rh.numLanes; l++) {
      const lx = startX + l * laneW;
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(lx + 2, 0, laneW - 4, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
      ctx.strokeRect(lx + 2, 0, laneW - 4, H);
    }

    // Target (hit zone) line
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(startX, targetY); ctx.lineTo(startX + laneW * rh.numLanes, targetY); ctx.stroke();
    ctx.restore();

    // Lane buttons (at target)
    for (let l = 0; l < rh.numLanes; l++) {
      const lx   = startX + l * laneW + laneW / 2;
      const glow = rh.laneFlash[l] > 0;
      ctx.save();
      ctx.beginPath(); ctx.arc(lx, targetY, noteR, 0, Math.PI * 2);
      ctx.fillStyle = glow ? rh.laneColors[l] : 'rgba(60,60,60,0.7)';
      ctx.fill();
      ctx.strokeStyle = rh.laneColors[l]; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }

    // Notes
    for (const n of rh.notes) {
      if (n.miss) continue;
      const lx = startX + n.lane * laneW + laneW / 2;
      ctx.save();
      if (n.hit) {
        const a = n.flash / 0.25;
        ctx.beginPath(); ctx.arc(lx, targetY, noteR * (1.5 + (1 - a) * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${a * 0.6})`; ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(lx, n.y, noteR, 0, Math.PI * 2);
        ctx.fillStyle = rh.laneColors[n.lane]; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.restore();
    }

    // HUD
    ctx.save();
    ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(W / 2 - 100, 6, 200, 44);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`Score: ${this.gameState.score}`, W / 2, 24);
    ctx.fillStyle = rh.combo > 0 ? '#ffdd44' : 'rgba(255,255,255,0.4)';
    ctx.fillText(`Combo ×${rh.combo}`, W / 2, 42);

    // Key hints
    const keyLabels = ['←', '↑', '→', '↓'];
    for (let l = 0; l < rh.numLanes; l++) {
      const lx = startX + l * laneW + laneW / 2;
      ctx.font = '11px monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(keyLabels[l], lx, targetY + noteR + 14);
    }
    ctx.restore();

    if (this.gameState.flashScreen > 0) {
      const a = Math.min(0.5, this.gameState.flashScreen * 1.5);
      ctx.fillStyle = `rgba(255,60,60,${a})`; ctx.fillRect(0, 0, W, H);
    }
  }

  // ── Racing: Top-Down (Phase I) ────────────────────────────────────────────

  _initRacing() {
    const W   = this.canvas.width;
    const H   = this.canvas.height;
    const gs  = this.level.gameSettings || {};
    const player = this.entities.find(e => e.role === 'playerMain');

    // Vehicle state (separate from entity physics — full control)
    this._car = {
      x:     player ? player.position.x : W / 2,
      y:     player ? player.position.y : H / 2,
      angle: 0,          // radians; 0 = pointing up
      speed: 0,          // current forward speed (px/s)
      maxSpeed:   320,
      accel:      240,
      friction:   0.92,
      steerRate:  2.6,   // rad/s at max speed
      driftFactor: 0.88, // lateral velocity retention (< 1 = grip, closer to 1 = drift)
      vx: 0, vy: 0,      // world-space velocity for drift
      laps:     0,
      maxLaps:  gs.laps     ?? 3,
      lapTimer: 0,
      bestLap:  Infinity,
      lastCheckpoint: -1,
    };
    this.gameState.timer    = gs.timerSeconds ?? 90;
    this.gameState.timerRunning = true;
    this.gameState.score    = 0;
    this.cameraX = 0; this.cameraY = 0;

    // Track: oval / closed waypoints looping around the level
    this._raceTrack = this._buildOvalTrack(W, H);
    this._raceParticles = [];  // tire smoke
    this._emitState();
  }

  _buildOvalTrack(W, H) {
    // Oval lap path: 8 waypoints forming an ellipse
    const cx = W / 2, cy = H / 2;
    const rx = W * 0.40, ry = H * 0.36;
    const pts = [];
    const N = 12;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }
    return pts;
  }

  _resetRacing() {
    if (!this._car) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const player = this.entities.find(e => e.role === 'playerMain');
    const gs = this.level.gameSettings || {};
    this._car.x = player ? player.position.x : W / 2;
    this._car.y = player ? player.position.y : H / 2;
    this._car.angle  = 0; this._car.speed = 0;
    this._car.vx = 0;     this._car.vy = 0;
    this._car.laps = 0;   this._car.lapTimer = 0;
    this._car.lastCheckpoint = -1;
    this._raceParticles = [];
    this.gameState.timer = gs.timerSeconds ?? 90;
    this.gameState.timerRunning = true;
    this.gameState.score = 0;
    this.gameState.gameOver      = false;
    this.gameState.levelComplete = false;
    this._emitState();
  }

  _updateRacing(dt) {
    const car = this._car;
    if (this.gameState.gameOver || this.gameState.levelComplete) return;

    // Timer
    if (this.gameState.timerRunning) {
      this.gameState.timer = Math.max(0, this.gameState.timer - dt);
      if (this.gameState.timer <= 0) {
        this.gameState.gameOver = true;
        this._emitState();
        return;
      }
    }

    // Steering (angle in radians)
    const steer = (this.input.left ? -1 : 0) + (this.input.right ? 1 : 0);
    const speedFactor = Math.min(1, Math.abs(car.speed) / car.maxSpeed);
    car.angle += steer * car.steerRate * speedFactor * dt;

    // Acceleration / brake
    if (this.input.up)   car.speed = Math.min(car.maxSpeed, car.speed + car.accel * dt);
    if (this.input.down) car.speed = Math.max(-car.maxSpeed * 0.45, car.speed - car.accel * 1.3 * dt);
    if (!this.input.up && !this.input.down) car.speed *= Math.pow(car.friction, dt * 60);

    // Forward vector
    const fwd = { x: Math.sin(car.angle), y: -Math.cos(car.angle) };
    // Target velocity = speed in fwd direction
    const tVx = fwd.x * car.speed;
    const tVy = fwd.y * car.speed;
    // Drift: blend actual velocity toward target velocity
    car.vx = car.vx * car.driftFactor + tVx * (1 - car.driftFactor);
    car.vy = car.vy * car.driftFactor + tVy * (1 - car.driftFactor);
    car.x += car.vx * dt;
    car.y += car.vy * dt;

    // Camera follows car
    const W = this.canvas.width, H = this.canvas.height;
    this.cameraX = Math.max(0, car.x - W / 2);
    this.cameraY = Math.max(0, car.y - H / 2);

    // Lap detection via waypoints
    car.lapTimer += dt;
    const wps = this._raceTrack;
    for (let i = 0; i < wps.length; i++) {
      const wp = wps[i];
      if (Math.hypot(car.x - wp.x, car.y - wp.y) < 40) {
        const next = (car.lastCheckpoint + 1) % wps.length;
        if (i === next) {
          car.lastCheckpoint = i;
          if (i === 0 && car.lastCheckpoint !== -1) {
            // Crossed start/finish
            if (car.lapTimer < car.bestLap) car.bestLap = car.lapTimer;
            car.laps++;
            car.lapTimer = 0;
            this.gameState.score = car.laps;
            this.gameState.flashScreen = 0.3;
            if (car.laps >= car.maxLaps) {
              this.gameState.levelComplete = true;
            }
            this._emitState();
          }
        }
      }
    }

    // Tire smoke particles when drifting
    const drift = Math.abs(car.vx * fwd.y - car.vy * fwd.x);
    if (drift > 30 && Math.random() < 0.4) {
      this._raceParticles.push({ x: car.x, y: car.y, vx: (Math.random()-0.5)*20, vy: (Math.random()-0.5)*20, life: 0.6, maxLife: 0.6 });
    }
    for (let i = this._raceParticles.length - 1; i >= 0; i--) {
      const p = this._raceParticles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) this._raceParticles.splice(i, 1);
    }

    if (this.gameState.flashScreen > 0) this.gameState.flashScreen = Math.max(0, this.gameState.flashScreen - dt);
  }

  _drawRacing() {
    const ctx = this.ctx;
    const car = this._car;
    const W   = this.canvas.width;
    const H   = this.canvas.height;
    const cx  = this.cameraX;
    const cy  = this.cameraY;

    // Background (grass)
    ctx.fillStyle = '#3a7a3a'; ctx.fillRect(0, 0, W, H);

    // Track ribbon
    const wps = this._raceTrack;
    if (wps.length >= 2) {
      ctx.save();
      ctx.translate(-cx, -cy);
      // Shadow
      ctx.beginPath();
      ctx.moveTo(wps[0].x, wps[0].y);
      for (let i = 1; i < wps.length; i++) ctx.lineTo(wps[i].x, wps[i].y);
      ctx.closePath();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 90; ctx.lineJoin = 'round'; ctx.stroke();
      // Asphalt
      ctx.beginPath();
      ctx.moveTo(wps[0].x, wps[0].y);
      for (let i = 1; i < wps.length; i++) ctx.lineTo(wps[i].x, wps[i].y);
      ctx.closePath();
      ctx.strokeStyle = '#555'; ctx.lineWidth = 70; ctx.stroke();
      // Center line (dashed)
      ctx.beginPath();
      ctx.moveTo(wps[0].x, wps[0].y);
      for (let i = 1; i < wps.length; i++) ctx.lineTo(wps[i].x, wps[i].y);
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2; ctx.setLineDash([20, 20]); ctx.stroke();
      ctx.setLineDash([]);
      // Start/finish line
      ctx.fillStyle = '#fff'; ctx.fillRect(wps[0].x - 40, wps[0].y - 5, 80, 10);
      ctx.restore();
    }

    // Tire smoke particles
    ctx.save(); ctx.translate(-cx, -cy);
    for (const p of this._raceParticles) {
      const a = (p.life / p.maxLife) * 0.4;
      ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,200,200,${a})`; ctx.fill();
    }
    ctx.restore();

    // Car (draw as rotated rectangle)
    ctx.save();
    ctx.translate(car.x - cx, car.y - cy);
    ctx.rotate(car.angle);
    const cw = 18, ch2 = 30;
    ctx.fillStyle = '#e03030';
    ctx.fillRect(-cw / 2, -ch2 / 2, cw, ch2);
    // Windshield
    ctx.fillStyle = 'rgba(100,200,255,0.7)';
    ctx.fillRect(-cw / 2 + 2, -ch2 / 2 + 4, cw - 4, 10);
    // Wheels
    ctx.fillStyle = '#111';
    const wheels = [[-cw/2 - 3, -ch2/2 + 4], [cw/2, -ch2/2 + 4], [-cw/2 - 3, ch2/2 - 12], [cw/2, ch2/2 - 12]];
    wheels.forEach(([wx, wy]) => ctx.fillRect(wx, wy, 4, 10));
    ctx.restore();

    // HUD overlay
    ctx.save();
    ctx.font = 'bold 14px monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(6, 6, 180, 54);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`Lap: ${Math.min(car.laps + 1, car.maxLaps)} / ${car.maxLaps}`, 14, 24);
    ctx.fillText(`Speed: ${Math.round(Math.abs(car.speed))} px/s`, 14, 40);
    const t = Math.ceil(this.gameState.timer);
    ctx.fillStyle = t < 15 ? '#ff6666' : '#ffffff';
    ctx.fillText(`Time: ${t}s`, 14, 56);
    ctx.restore();

    if (this.gameState.flashScreen > 0) {
      const a = Math.min(0.45, this.gameState.flashScreen * 1.2);
      ctx.fillStyle = `rgba(200,255,200,${a})`; ctx.fillRect(0, 0, W, H);
    }
  }

  // ── Racing: Endless Road (Phase I) ───────────────────────────────────────

  _initEndlessRoad() {
    const W   = this.canvas.width;
    const H   = this.canvas.height;
    const gs  = this.level.gameSettings || {};
    this._er = {
      y:          H * 0.7,         // player's Y position on screen (fixed)
      x:          W / 2,           // player X
      speed:      200,             // forward scroll speed (px/s), increases over time
      dx:         0,               // lateral velocity
      maxX:       W,
      lives:      gs.lives ?? 3,
      invincible: 0,
      obstacles:  [],              // { x, y, w, h, speed, color }
      spawnTimer: 1.2,
      distance:   0,
    };
    this.gameState.lives = this._er.lives;
    this.gameState.score = 0;
    this._emitState();
  }

  _resetEndlessRoad() {
    if (!this._er) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const gs = this.level.gameSettings || {};
    this._er.x     = W / 2; this._er.y = H * 0.7;
    this._er.speed = 200;   this._er.dx = 0;
    this._er.lives = gs.lives ?? 3;
    this._er.invincible = 0;
    this._er.obstacles  = [];
    this._er.spawnTimer = 1.2;
    this._er.distance   = 0;
    this.gameState.score = 0;
    this.gameState.lives = this._er.lives;
    this.gameState.gameOver      = false;
    this.gameState.levelComplete = false;
    this._emitState();
  }

  _updateEndlessRoad(dt) {
    const er  = this._er;
    const W   = this.canvas.width;
    const H   = this.canvas.height;
    if (this.gameState.gameOver) return;

    er.speed   = Math.min(600, er.speed + 15 * dt);
    er.distance += er.speed * dt;
    this.gameState.score = Math.round(er.distance / 10);

    // Player steering
    const lateralSpeed = 220;
    if (this.input.left)  er.dx = -lateralSpeed;
    else if (this.input.right) er.dx = lateralSpeed;
    else er.dx *= 0.85;
    er.x = Math.max(W * 0.22, Math.min(W * 0.78, er.x + er.dx * dt));

    // Spawn obstacles
    er.spawnTimer -= dt;
    if (er.spawnTimer <= 0) {
      const laneW = W * 0.56 / 3;
      const lane  = Math.floor(Math.random() * 3);
      const ox    = W * 0.22 + lane * laneW + laneW / 2;
      const colors = ['#2255cc', '#cc5522', '#22aa44', '#aa22aa'];
      er.obstacles.push({ x: ox, y: -40, w: 32, h: 50, speed: er.speed * 0.5, color: colors[Math.floor(Math.random() * colors.length)] });
      er.spawnTimer = Math.max(0.35, 1.4 - er.distance / 15000);
    }

    // Move obstacles
    for (let i = er.obstacles.length - 1; i >= 0; i--) {
      const o = er.obstacles[i];
      o.y += (er.speed - o.speed) * dt;
      if (o.y > H + 60) { er.obstacles.splice(i, 1); continue; }

      // Collision with player
      if (er.invincible <= 0) {
        const px = er.x, py = er.y;
        const pw = 22, ph = 36;
        if (px - pw/2 < o.x + o.w/2 && px + pw/2 > o.x - o.w/2 &&
            py - ph/2 < o.y + o.h/2 && py + ph/2 > o.y - o.h/2) {
          er.lives--;
          this.gameState.lives = er.lives;
          er.invincible = 1.5;
          this.gameState.flashScreen = 0.4;
          if (er.lives <= 0) this.gameState.gameOver = true;
          this._emitState();
          er.obstacles.splice(i, 1);
          continue;
        }
      }
    }

    if (er.invincible > 0) er.invincible -= dt;
    if (this.gameState.flashScreen > 0) this.gameState.flashScreen = Math.max(0, this.gameState.flashScreen - dt);
    this._emitState();
  }

  _drawEndlessRoad() {
    const ctx = this.ctx;
    const er  = this._er;
    const W   = this.canvas.width;
    const H   = this.canvas.height;

    // Sky + ground
    ctx.fillStyle = '#6699cc'; ctx.fillRect(0, 0, W, H / 2);
    ctx.fillStyle = '#4a7a30'; ctx.fillRect(0, H / 2, W, H / 2);

    // Road
    const roadX = W * 0.22, roadW = W * 0.56;
    ctx.fillStyle = '#666'; ctx.fillRect(roadX, 0, roadW, H);
    // Lane markers (scrolling)
    const laneW   = roadW / 3;
    const scroll  = (this.time * (er.speed * 0.6)) % 80;
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 3; ctx.setLineDash([40, 40]);
    for (let lane = 1; lane < 3; lane++) {
      const lx = roadX + lane * laneW;
      ctx.beginPath(); ctx.moveTo(lx, -scroll); ctx.lineTo(lx, H + 80); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
    // Road edges
    ctx.fillStyle = '#fff';
    ctx.fillRect(roadX, 0, 4, H);
    ctx.fillRect(roadX + roadW - 4, 0, 4, H);

    // Obstacles
    for (const o of er.obstacles) {
      ctx.fillStyle = o.color;
      ctx.fillRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
      // Windshield
      ctx.fillStyle = 'rgba(150,220,255,0.6)';
      ctx.fillRect(o.x - o.w / 2 + 3, o.y - o.h / 2 + 4, o.w - 6, 12);
    }

    // Player car
    const blink = er.invincible > 0 && Math.floor(this.time * 8) % 2 === 0;
    if (!blink) {
      ctx.save();
      ctx.translate(er.x, er.y);
      ctx.fillStyle = '#e03030';
      ctx.fillRect(-11, -18, 22, 36);
      ctx.fillStyle = 'rgba(100,200,255,0.7)';
      ctx.fillRect(-9, -14, 18, 10);
      ctx.fillStyle = '#111';
      [[-13, -12], [10, -12], [-13, 10], [10, 10]].forEach(([wx, wy]) => ctx.fillRect(wx, wy, 4, 10));
      ctx.restore();
    }

    // HUD
    ctx.save();
    ctx.font = 'bold 14px monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(6, 6, 150, 40);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`Score: ${this.gameState.score}`, 12, 24);
    ctx.fillText(`Lives: ${'❤'.repeat(Math.max(0, er.lives))}`, 12, 42);
    ctx.restore();

    if (this.gameState.flashScreen > 0) {
      const a = Math.min(0.55, this.gameState.flashScreen * 1.5);
      ctx.fillStyle = `rgba(255,60,60,${a})`; ctx.fillRect(0, 0, W, H);
    }
  }

  _drawSolitaire() {
    const ctx = this.ctx;
    const sol = this._sol;
    if (!sol) return;
    const W   = this.canvas.width;
    const H   = this.canvas.height;
    const { cardW: cw, cardH: ch, pad, offsetY } = sol;
    const colSpacing = (W - pad * 2) / 7;

    ctx.fillStyle = '#166030'; ctx.fillRect(0, 0, W, H);

    const drawCard = (card, x, y, sel) => {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
      ctx.fillStyle    = card.faceUp ? '#f8f4ee' : '#1a3a8a';
      ctx.strokeStyle  = sel ? '#ffdd44' : 'rgba(0,0,0,0.2)';
      ctx.lineWidth    = sel ? 2 : 1;
      ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 4); ctx.fill(); ctx.stroke();
      ctx.shadowColor  = 'transparent';
      if (card.faceUp) {
        const fs = Math.round(cw * 0.22);
        ctx.font = `bold ${fs}px monospace`;
        ctx.fillStyle = card.red ? '#cc1111' : '#111111';
        ctx.textAlign = 'left'; ctx.fillText(card.rank, x + 3, y + fs + 2);
        ctx.fillText(card.suit, x + 3, y + fs * 2 + 2);
      }
      ctx.restore();
    };

    const drawEmpty = (x, y) => {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 4); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    };

    // Stock
    if (sol.stock.length) {
      drawCard({ faceUp: false }, pad, pad, false);
      ctx.save(); ctx.font = '9px monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(sol.stock.length, pad + cw / 2, pad + ch + 11);
      ctx.restore();
    } else {
      drawEmpty(pad, pad);
      ctx.save(); ctx.font = '10px monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillText('↺', pad + cw / 2, pad + ch / 2 + 5);
      ctx.restore();
    }

    // Waste top
    if (sol.waste.length) {
      const isSel = sol.selected?.pile === 'waste';
      drawCard(sol.waste[sol.waste.length - 1], pad + colSpacing, pad, isSel);
    } else {
      drawEmpty(pad + colSpacing, pad);
    }

    // Foundation piles
    for (let f = 0; f < 4; f++) {
      const fx = pad + (f + 3) * colSpacing;
      const pile = sol.foundation[f];
      if (pile.length) {
        const isSel = sol.selected?.pile === 'foundation' && sol.selected.colIdx === f;
        drawCard(pile[pile.length - 1], fx, pad, isSel);
      } else {
        drawEmpty(fx, pad);
        // Suit hint
        ctx.save(); ctx.font = `${Math.round(ch * 0.35)}px monospace`; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillText(['♠','♣','♥','♦'][f], fx + cw / 2, pad + ch * 0.55);
        ctx.restore();
      }
    }

    // Tableau columns
    const overlap = Math.round(ch * 0.25);
    for (let c = 0; c < 7; c++) {
      const tx  = pad + c * colSpacing;
      const col = sol.tableau[c];
      if (!col.length) { drawEmpty(tx, offsetY); continue; }
      for (let i = 0; i < col.length; i++) {
        const ty    = offsetY + i * overlap;
        const isSel = sol.selected?.pile === 'tableau' && sol.selected.colIdx === c && sol.selected.cardIdx <= i;
        drawCard(col[i], tx, ty, isSel);
      }
    }
  }

  // ── Multiplayer helpers ────────────────────────────────────────────────────

  _mpTick(dt) {
    const mp = this.mpAdapter;
    if (!mp) return;

    // Interpolate all remote players toward their target positions
    const LERP = Math.min(1, dt * 12); // ~12x per second catch-up
    for (const rp of mp.remotePlayers.values()) {
      rp.x += (rp.tx - rp.x) * LERP;
      rp.y += (rp.ty - rp.y) * LERP;
    }

    // Send our local player's state
    const player = this._findPlayer();
    if (player) {
      mp.sendState({
        x: player.position.x,
        y: player.position.y,
        anim: player.currentAnim,
        dir: player._facingRight ? 1 : -1,
        hp: player._hp,
      });
    }
  }

  _drawRemotePlayers() {
    const mp = this.mpAdapter;
    if (!mp) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(-this.cameraX, -this.cameraY);
    ctx.imageSmoothingEnabled = false;

    for (const [id, rp] of mp.remotePlayers) {
      const x = rp.x;
      const y = rp.y;
      const tpl = rp.entityTemplate;
      const w = tpl?.renderSize?.width  || 32;
      const h = tpl?.renderSize?.height || 48;

      // Try to draw the player sprite if we have the sheet loaded
      let drew = false;
      if (tpl) {
        const sheetId = tpl.spriteSheetAssetId || tpl.animations?.[0]?.spriteSheetId;
        const img = sheetId ? this.images.get(sheetId) : null;
        if (img) {
          // Find the matching sprite sheet asset
          const sheet = (this.assets.sprites || []).find(s => s.id === sheetId);
          if (sheet) {
            // Use idle or first animation frame
            const animName = rp.anim || tpl.defaultAnimation || sheet.animations?.[0]?.name;
            const anim = (sheet.animations || []).find(a => a.name === animName) || sheet.animations?.[0];
            if (anim && anim.frames?.length) {
              const frame = anim.frames[0];
              const tsCols = Math.max(1, sheet.cols || 1);
              const tw = sheet.tileWidth || 32;
              const th = sheet.tileHeight || 32;
              const fi = frame.index ?? 0;
              const sx = (fi % tsCols) * tw;
              const sy = Math.floor(fi / tsCols) * th;
              ctx.save();
              if (rp.dir === -1) {
                ctx.translate(x + w, y);
                ctx.scale(-1, 1);
                ctx.drawImage(img, sx, sy, tw, th, 0, 0, w, h);
              } else {
                ctx.drawImage(img, sx, sy, tw, th, x, y, w, h);
              }
              ctx.restore();
              drew = true;
            }
          }
        }
      }

      if (!drew) {
        // Fallback: colored rectangle
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = rp._color || '#88aaff';
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
      }

      // Username label above the sprite
      const label = rp.username || '?';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      const lx = x + w / 2;
      const ly = y - 5;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(lx - ctx.measureText(label).width / 2 - 3, ly - 10, ctx.measureText(label).width + 6, 13);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, lx, ly);
    }
    ctx.restore();
  }
}
