// Multiplayer relay server — WebSocket rooms keyed by slug:levelId.
// No server-side physics. Each client is authoritative for its own player.
// Server relays state and action messages between peers in the same room.
import { WebSocketServer } from 'ws';
import { parse } from 'url';
import { randomUUID } from 'crypto';

// rooms: Map<roomKey, Map<playerId, PlayerEntry>>
// PlayerEntry: { ws, username, state, entityTemplate, lastSeen, userId }
const rooms      = new Map();
const userIndex  = new Map(); // roomKey → Map<userId, playerId>  (one session per user)

function getRoom(key) {
  if (!rooms.has(key)) rooms.set(key, new Map());
  return rooms.get(key);
}

function getRoomUserIndex(key) {
  if (!userIndex.has(key)) userIndex.set(key, new Map());
  return userIndex.get(key);
}

function dropPlayer(roomKey, playerId) {
  const room = rooms.get(roomKey);
  if (!room) return;
  const entry = room.get(playerId);
  if (entry?.userId) {
    const idx = userIndex.get(roomKey);
    if (idx?.get(entry.userId) === playerId) idx.delete(entry.userId);
  }
  room.delete(playerId);
  if (room.size === 0) { rooms.delete(roomKey); userIndex.delete(roomKey); }
}

function broadcast(room, msg, exceptId = null) {
  if (!room) return;
  const data = JSON.stringify(msg);
  for (const [id, entry] of room) {
    if (id === exceptId) continue;
    if (entry.ws.readyState === 1 /* OPEN */) entry.ws.send(data);
  }
}

export function createMultiplayerServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  // Intercept HTTP upgrade for /mp/:slug/:levelId only
  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url || '');
    const m = pathname.match(/^\/mp\/([^/]+)\/([^/]+)$/);
    if (!m) { socket.destroy(); return; }
    const [, slug, levelId] = m;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, slug, levelId);
    });
  });

  wss.on('connection', (ws, slug, levelId) => {
    const roomKey = `${slug}:${levelId}`;
    const room = getRoom(roomKey);

    // Hard cap — agents arena gets a larger room; game worlds cap at 16
    const maxPlayers = roomKey === 'agents:arena' ? 100 : 16;
    if (room.size >= maxPlayers) {
      ws.send(JSON.stringify({ t: 'error', msg: 'Room full' }));
      ws.close(1008, 'Room full');
      return;
    }

    const playerId = randomUUID();
    const entry = { ws, username: 'Player', isAgent: false, state: null, entityTemplate: null, lastSeen: Date.now() };
    room.set(playerId, entry);

    // Send current room snapshot to the new joiner
    const snapshot = [];
    for (const [id, p] of room) {
      if (id === playerId) continue;
      snapshot.push({ id, username: p.username, isAgent: p.isAgent, state: p.state, entityTemplate: p.entityTemplate });
    }
    ws.send(JSON.stringify({ t: 'room', myId: playerId, players: snapshot }));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      entry.lastSeen = Date.now();

      switch (msg.t) {
        case 'join':
          entry.username = String(msg.username || 'Player').slice(0, 24);
          entry.isAgent  = !!msg.isAgent;
          if (msg.entityTemplate) entry.entityTemplate = msg.entityTemplate;

          // Enforce one active session per user — kick stale connection
          if (msg.userId) {
            const idx = getRoomUserIndex(roomKey);
            const oldId = idx.get(msg.userId);
            if (oldId && oldId !== playerId && room.has(oldId)) {
              const old = room.get(oldId);
              try { old.ws.send(JSON.stringify({ t: 'kick', reason: 'session_replaced' })); } catch {}
              old.ws.close(1000, 'session_replaced');
              room.delete(oldId);
              broadcast(room, { t: 'leave', id: oldId });
            }
            idx.set(msg.userId, playerId);
            entry.userId = msg.userId;
          }

          broadcast(room, { t: 'join', id: playerId, username: entry.username, isAgent: entry.isAgent, entityTemplate: entry.entityTemplate }, playerId);
          break;

        case 'state':
          entry.state = msg;
          // Relay with sender id injected — strip t so receiver adds their own
          broadcast(room, { t: 'state', id: playerId, x: msg.x, y: msg.y, anim: msg.anim, dir: msg.dir, hp: msg.hp }, playerId);
          break;

        case 'action':
          broadcast(room, { t: 'action', id: playerId, act: msg.act, data: msg.data }, playerId);
          break;
      }
    });

    const onClose = () => {
      dropPlayer(roomKey, playerId);
      broadcast(rooms.get(roomKey), { t: 'leave', id: playerId });
    };
    ws.on('close', onClose);
    ws.on('error', onClose);
  });

  // Evict dead connections every 30s
  setInterval(() => {
    const now = Date.now();
    for (const [roomKey, room] of rooms) {
      for (const [playerId, entry] of room) {
        if (entry.ws.readyState > 1 /* CLOSING or CLOSED */ && now - entry.lastSeen > 15000) {
          dropPlayer(roomKey, playerId);
          broadcast(rooms.get(roomKey), { t: 'leave', id: playerId });
        }
      }
      if (room.size === 0) rooms.delete(roomKey);
    }
  }, 30000);

  console.log('[mp] WebSocket relay attached');
  return wss;
}
