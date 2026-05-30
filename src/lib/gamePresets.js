// Game presets — numeric values and defaults for each genre/subtype.
// Values reference GAME_BUILDER_GAMES.md §4.
//
// Runtime reads:
//   level.gravity          → physics gravity (0 = top-down, >0 = platformer)
//   entity.stats.speed     → player move speed (px/s)
//   entity.stats.runSpeed  → player dash speed (px/s)
//   entity.stats.jumpHeight → jump height in tiles

export const GENRE_TREE = [
  {
    value: 'platformer',
    label: 'Platformer',
    subtypes: [
      { value: 'classic-mario',     label: 'Classic Mario' },
      { value: 'endless-runner',    label: 'Endless Runner' },
      { value: 'puzzle-platformer', label: 'Puzzle Platformer' },
      { value: 'double-jump',       label: 'Double Jump' },
      { value: 'dash-mechanic',     label: 'Dash Mechanic' },
      { value: 'wall-jump',         label: 'Wall Jump' },
    ],
  },
  {
    value: 'topdown',
    label: 'Top-Down',
    subtypes: [
      { value: 'action-rpg',        label: 'Action RPG (Zelda-like)' },
      { value: 'vampire-survivors', label: 'Vampire Survivors' },
      { value: 'survival-waves',    label: 'Survival Waves' },
      { value: 'collectathon',      label: 'Collectathon' },
      { value: 'stealth',           label: 'Stealth' },
    ],
  },
  {
    value: 'arcade',
    label: 'Arcade Classic',
    subtypes: [
      { value: 'space-invaders',    label: 'Space Invaders' },
      { value: 'pac-man',           label: 'Pac-Man' },
      { value: 'snake',             label: 'Snake' },
      { value: 'breakout',          label: 'Breakout / Arkanoid' },
      { value: 'pong',              label: 'Pong' },
    ],
  },
  {
    value: 'casual',
    label: 'Casual / Hypercasual',
    subtypes: [
      { value: 'flappy-bird',       label: 'Flappy Bird' },
      { value: 'endless-score',     label: 'Endless Score Chaser' },
    ],
  },
  {
    value: 'strategy',
    label: 'Strategy',
    subtypes: [
      { value: 'tower-defense',     label: 'Tower Defense' },
      { value: 'match-3',           label: 'Match-3 Puzzle' },
    ],
  },
  {
    value: 'card',
    label: 'Card Game',
    subtypes: [
      { value: 'blackjack',         label: 'Blackjack' },
      { value: 'solitaire',         label: 'Solitaire (Klondike)' },
    ],
  },
  {
    value: 'racing',
    label: 'Racing',
    subtypes: [
      { value: 'top-down',          label: 'Top-Down Racing' },
      { value: 'endless',           label: 'Endless Road' },
    ],
  },
  {
    value: 'rhythm',
    label: 'Rhythm',
    subtypes: [
      { value: 'lane-tap',          label: 'Lane Tap (Guitar Hero)' },
    ],
  },
  {
    value: 'fighting',
    label: 'Fighting',
    subtypes: [
      { value: 'brawler',           label: '1v1 Brawler' },
    ],
  },
];

// Key: `${primary}.${secondary}`
export const GAME_PRESETS = {
  // ── Platformers ────────────────────────────────────────────────────────────
  'platformer.classic-mario': {
    label: 'Classic Mario',
    description: 'Side-scrolling platformer. Jump on enemies, collect coins, reach the flag.',
    physics: { gravity: 1200 },
    playerStats: { speed: 300, runSpeed: 480, jumpHeight: 4 },
    game: { lives: 3, startScore: 0 },
    camera: { axis: 'x' },
    gravityDir: 'down',
    hud: { showScore: true, showLives: true, showCoins: true },
    events: {
      onDeath: 'lose-life',
      onDamage: 'flash-screen',
      onCollect: 'add-score:100',
      onLevelComplete: 'next-level',
    },
    mobileControls: { layout: 'platformer' },
  },

  'platformer.endless-runner': {
    label: 'Endless Runner',
    description: 'Auto-run right. Switch lanes, jump, and shoot obstacles. Score by distance.',
    physics: { gravity: 1200 },
    playerStats: { speed: 240, jumpHeight: 3 },
    game: { lives: 3, startScore: 0, winDistance: 0 },
    camera: { axis: 'x' },
    gravityDir: 'down',
    hud: { showScore: true, showLives: true },
    events: { onDeath: 'lose-life', onCollect: 'add-score:50' },
    mobileControls: { layout: 'up-down-only' },
    // Runner-specific defaults — read by buildGame
    runner: {
      lanes:             3,
      laneSpacing:       0,     // 0 = auto-distribute
      baseSpeed:         240,
      speedRampRate:     2,     // +2% per interval
      speedRampInterval: 8,     // every 8 seconds
      speedMax:          800,   // cap at 800 px/s
      playerCanShoot:    true,
      bulletSpeed:       700,
      bulletDamage:      25,
      bulletSize:        5,
      bulletColor:       '#fffa60',
      winDistance:       0,
    },
    // Distance-based wave schedule — spawned from right edge at configured lane
    spawnWaves: [
      { triggerType: 'distance', triggerDistance: 30,  count: 1, runnerLane: 'any' },
      { triggerType: 'distance', triggerDistance: 80,  count: 2, runnerLane: 1     },
      { triggerType: 'distance', triggerDistance: 150, count: 3, runnerLane: 'any' },
      { triggerType: 'distance', triggerDistance: 250, count: 4, runnerLane: 0     },
      { triggerType: 'distance', triggerDistance: 400, count: 5, runnerLane: 'any' },
    ],
  },

  'platformer.puzzle-platformer': {
    label: 'Puzzle Platformer',
    description: 'Explore and solve environmental puzzles. No combat — obstacles are the challenge.',
    physics: { gravity: 900 },
    playerStats: { speed: 200, jumpHeight: 3 },
    game: { lives: 0, startScore: 0 },
    camera: { axis: 'x' },
    gravityDir: 'down',
    hud: { showScore: false, showLives: false, showTimer: true },
    events: {
      onLevelComplete: 'next-level',
    },
    mobileControls: { layout: 'platformer' },
  },

  'platformer.double-jump': {
    label: 'Double Jump',
    description: 'Precision platformer with a second mid-air jump.',
    physics: { gravity: 1000 },
    playerStats: { speed: 250, jumpHeight: 3 },
    game: { lives: 3, startScore: 0 },
    camera: { axis: 'x' },
    gravityDir: 'down',
    hud: { showScore: true, showLives: true },
    events: { onDeath: 'lose-life', onLevelComplete: 'next-level' },
    mobileControls: { layout: 'platformer' },
  },

  'platformer.dash-mechanic': {
    label: 'Dash Mechanic',
    description: 'Fast-paced platformer. Dash through gaps and enemies.',
    physics: { gravity: 1200 },
    playerStats: { speed: 300, runSpeed: 600, jumpHeight: 3 },
    game: { lives: 3, startScore: 0 },
    camera: { axis: 'x' },
    gravityDir: 'down',
    hud: { showScore: true, showLives: true },
    events: { onDeath: 'lose-life', onDamage: 'flash-screen', onLevelComplete: 'next-level' },
    mobileControls: { layout: 'platformer-dash' },
  },

  'platformer.wall-jump': {
    label: 'Wall Jump',
    description: 'Bounce off walls to ascend and navigate vertical levels.',
    physics: { gravity: 1200 },
    playerStats: { speed: 250, jumpHeight: 3 },
    game: { lives: 3, startScore: 0 },
    camera: { axis: 'both' },
    gravityDir: 'down',
    hud: { showScore: true, showLives: true },
    events: { onDeath: 'lose-life', onLevelComplete: 'next-level' },
    mobileControls: { layout: 'platformer' },
  },

  // ── Top-Down ───────────────────────────────────────────────────────────────
  'topdown.action-rpg': {
    label: 'Action RPG',
    description: '8-direction movement, sword attacks, interactable objects, dungeon exploration.',
    physics: { gravity: 0 },
    playerStats: { speed: 250 },
    game: { lives: 3, startScore: 0 },
    camera: { axis: 'both' },
    gravityDir: 'none',
    hud: { showScore: false, showLives: true, showHealth: true },
    events: {
      onDeath: 'lose-life',
      onDamage: 'flash-screen',
      onCollect: 'add-score:50',
      onLevelComplete: 'next-level',
    },
    mobileControls: { layout: 'topdown-action' },
  },

  'topdown.vampire-survivors': {
    label: 'Vampire Survivors',
    description: 'Auto-attack arena. Move only — survive endless enemy waves.',
    physics: { gravity: 0 },
    playerStats: { speed: 200 },
    game: { lives: 1, startScore: 0, winWaves: 0 }, // 0 = infinite survival; set N to clear after N waves
    camera: { axis: 'both' },
    gravityDir: 'none',
    hud: { showScore: true, showLives: false, showTimer: true },
    events: {
      onDeath: 'game-over',
      onCollect: 'add-score:10',
    },
    mobileControls: { layout: 'topdown-move-only' },
  },

  'topdown.survival-waves': {
    label: 'Survival Waves',
    description: 'Hold off enemy waves. Earn upgrades between rounds.',
    physics: { gravity: 0 },
    playerStats: { speed: 200 },
    game: { lives: 3, startScore: 0, winWaves: 5 }, // survive 5 waves → next level
    camera: { axis: 'both' },
    gravityDir: 'none',
    hud: { showScore: true, showLives: true, showHealth: true },
    events: {
      onDeath: 'lose-life',
      onDamage: 'flash-screen',
      onCollect: 'add-score:50',
    },
    mobileControls: { layout: 'topdown-action' },
  },

  'topdown.collectathon': {
    label: 'Collectathon',
    description: 'Collect all items to unlock the exit. Counter shown on HUD.',
    physics: { gravity: 0 },
    playerStats: { speed: 220 },
    game: { lives: 3, startScore: 0, winCoins: 10 }, // collect 10 items → next level
    camera: { axis: 'both' },
    gravityDir: 'none',
    hud: { showScore: true, showLives: true },
    events: {
      onCollect: 'add-score:100',
      onLevelComplete: 'next-level',
    },
    mobileControls: { layout: 'topdown-move-only' },
  },

  'topdown.stealth': {
    label: 'Stealth',
    description: 'Avoid enemy cones of vision. Move silently, use darkness.',
    physics: { gravity: 0 },
    playerStats: { speed: 120 },
    game: { lives: 1, startScore: 0 },
    camera: { axis: 'both' },
    gravityDir: 'none',
    hud: { showScore: false, showLives: false },
    events: {
      onDeath: 'game-over',
    },
    mobileControls: { layout: 'topdown-move-only' },
  },

  // ── Arcade Classics ────────────────────────────────────────────────────────
  'arcade.space-invaders': {
    label: 'Space Invaders',
    description: 'Shoot descending alien rows. 3 lives. Grid of enemies advances down.',
    physics: { gravity: 0 },
    playerStats: { speed: 200 },
    game: { lives: 3, startScore: 0 },
    camera: { axis: 'fixed' },
    gravityDir: 'none',
    hud: { showScore: true, showLives: true },
    events: {
      onDeath: 'lose-life',
      onCollect: 'add-score:10',
    },
    mobileControls: { layout: 'arcade-shooter' },
  },

  'arcade.pac-man': {
    label: 'Pac-Man',
    description: 'Navigate a maze, eat all dots, avoid ghosts. Power pellets = ghost hunter.',
    physics: { gravity: 0 },
    playerStats: { speed: 150 },
    game: { lives: 3, startScore: 0 },
    camera: { axis: 'fixed' },
    gravityDir: 'none',
    hud: { showScore: true, showLives: true },
    events: {
      onDeath: 'lose-life',
      onCollect: 'add-score:10',
    },
    mobileControls: { layout: 'dpad-only' },
  },

  'arcade.snake': {
    label: 'Snake',
    description: 'Eat food to grow longer. Avoid walls and your own tail.',
    physics: { gravity: 0 },
    playerStats: { speed: 120 },
    game: { lives: 1, startScore: 0 },
    camera: { axis: 'fixed' },
    gravityDir: 'none',
    hud: { showScore: true, showLives: false },
    events: {
      onDeath: 'game-over',
      onCollect: 'add-score:10',
    },
    mobileControls: { layout: 'dpad-only' },
  },

  'arcade.breakout': {
    label: 'Breakout / Arkanoid',
    description: 'Bounce a ball to destroy bricks. Paddle stays at the bottom.',
    physics: { gravity: 0 },
    playerStats: { speed: 300 },
    game: { lives: 3, startScore: 0 },
    camera: { axis: 'fixed' },
    gravityDir: 'none',
    hud: { showScore: true, showLives: true },
    events: {
      onDeath: 'lose-life',
      onCollect: 'add-score:10',
    },
    mobileControls: { layout: 'left-right-only' },
  },

  'arcade.pong': {
    label: 'Pong',
    description: 'Classic paddle game. Score by getting the ball past the opponent.',
    physics: { gravity: 0 },
    playerStats: { speed: 250 },
    game: { lives: 0, startScore: 0 },
    camera: { axis: 'fixed' },
    gravityDir: 'none',
    hud: { showScore: true, showLives: false },
    events: {
      onCollect: 'add-score:1',
      onDeath: 'game-over',
    },
    mobileControls: { layout: 'up-down-only' },
  },

  // ── Casual ─────────────────────────────────────────────────────────────────
  'casual.flappy-bird': {
    label: 'Flappy Bird',
    description: 'Tap to flap. Navigate through gaps in pipes. One life.',
    physics: { gravity: 600 },
    playerStats: { speed: 0, jumpHeight: 2 },
    game: { lives: 1, startScore: 0 },
    camera: { axis: 'fixed' },
    gravityDir: 'down',
    hud: { showScore: true, showLives: false },
    events: {
      onDeath: 'game-over',
      onCollect: 'add-score:1',
    },
    mobileControls: { layout: 'tap-only', tapAction: 'jump' },
  },

  'casual.endless-score': {
    label: 'Endless Score Chaser',
    description: 'Dodge incoming obstacles. Survive as long as possible.',
    physics: { gravity: 0 },
    playerStats: { speed: 200 },
    game: { lives: 1, startScore: 0 },
    camera: { axis: 'fixed' },
    gravityDir: 'none',
    hud: { showScore: true, showLives: false },
    events: {
      onDeath: 'game-over',
    },
    mobileControls: { layout: 'left-right-only' },
  },

  // ── Strategy ──────────────────────────────────────────────────────────────────
  'strategy.tower-defense': {
    label: 'Tower Defense',
    description: 'Enemies follow a path to your base. Place towers to stop them.',
    physics: { gravity: 0 },
    playerStats: { speed: 0 },
    game: { lives: 20, startScore: 0, winWaves: 10 }, // survive 10 waves → next level
    camera: { axis: 'fixed' },
    gravityDir: 'none',
    hud: { showScore: true, showLives: true, showWave: true },
    mobileControls: { layout: 'tap-only', tapAction: 'interact' },
  },

  'strategy.match-3': {
    label: 'Match-3 Puzzle',
    description: 'Swap adjacent tiles to match 3+ in a row. Clear the board.',
    physics: { gravity: 0 },
    playerStats: { speed: 0 },
    game: { lives: 3, startScore: 0, winScore: 1000 }, // reach 1000 pts → next level
    camera: { axis: 'fixed' },
    gravityDir: 'none',
    hud: { showScore: true, showLives: true },
    mobileControls: { layout: 'tap-only', tapAction: 'interact' },
  },

  // ── Card Games ─────────────────────────────────────────────────────────────────
  'card.blackjack': {
    label: 'Blackjack',
    description: 'Classic casino Blackjack. Beat the dealer to 21 without busting.',
    physics: { gravity: 0 },
    playerStats: { speed: 0 },
    game: { startBalance: 1000, startBet: 50 },
    camera: { axis: 'fixed' },
    gravityDir: 'none',
    hud: { showScore: true },
    mobileControls: { layout: 'tap-only', tapAction: 'interact' },
  },

  'card.solitaire': {
    label: 'Solitaire (Klondike)',
    description: 'Classic Klondike solitaire. Move all cards to the foundation.',
    physics: { gravity: 0 },
    playerStats: { speed: 0 },
    game: {},
    camera: { axis: 'fixed' },
    gravityDir: 'none',
    hud: { showScore: true },
    mobileControls: { layout: 'tap-only', tapAction: 'interact' },
  },

  // ── Racing ─────────────────────────────────────────────────────────────────────
  'racing.top-down': {
    label: 'Top-Down Racing',
    description: 'Overhead racing with drift physics. Complete laps before time runs out.',
    physics: { gravity: 0 },
    playerStats: { speed: 300 },
    game: { laps: 3, timerSeconds: 90 },
    camera: { axis: 'both' },
    gravityDir: 'none',
    hud: { showScore: true, showTimer: true },
    mobileControls: { layout: 'racing' },
  },

  'racing.endless': {
    label: 'Endless Road',
    description: 'Dodge traffic on a never-ending highway. Survive as long as possible.',
    physics: { gravity: 0 },
    playerStats: { speed: 200 },
    game: { lives: 3 },
    camera: { axis: 'y' },
    gravityDir: 'none',
    hud: { showScore: true, showLives: true },
    mobileControls: { layout: 'left-right-only' },
  },

  // ── Rhythm ─────────────────────────────────────────────────────────────────────
  'rhythm.lane-tap': {
    label: 'Lane Tap (Guitar Hero)',
    description: 'Hit notes as they reach the target line. Time your taps to the beat.',
    physics: { gravity: 0 },
    playerStats: { speed: 0 },
    game: { lives: 5, bpm: 120, lanes: 4 },
    camera: { axis: 'fixed' },
    gravityDir: 'none',
    hud: { showScore: true, showLives: true },
    mobileControls: { layout: 'tap-only', tapAction: 'interact' },
  },

  // ── Fighting ────────────────────────────────────────────────────────────────────
  'fighting.brawler': {
    label: '1v1 Brawler',
    description: 'Two fighters battle it out. First to drain the opponent\'s health wins the round.',
    physics: { gravity: 1200 },
    playerStats: { speed: 260, jumpForce: 560 },
    game: { rounds: 3, hp: 100, timerSeconds: 60 },
    camera: { axis: 'fixed' },
    gravityDir: 'down',
    hud: { showTimer: true },
    mobileControls: { layout: 'platformer' },
  },
};

// Returns the preset for a given primary + secondary key, or null.
export function getPreset(primary, secondary) {
  if (!primary || !secondary) return null;
  return GAME_PRESETS[`${primary}.${secondary}`] || null;
}

// Returns the list of subtypes for a primary genre.
export function getSubtypes(primary) {
  const genre = GENRE_TREE.find(g => g.value === primary);
  return genre?.subtypes || [];
}

const _mkId = () => Math.random().toString(36).substring(2, 9);

function _base(overrides) {
  return {
    id: _mkId(),
    type: 'GameEntity',
    name: 'Entity',
    role: 'prop',
    position: { x: 0, y: 0 },
    renderSize: { width: 64, height: 64 },
    animations: [],
    spriteSheetAssetId: null,
    defaultAnimation: null,
    facing: 'right',
    spriteOffsetY: 0,
    stats: { hp: 100, speed: 100, runSpeed: 180, damage: 10, jumpHeight: 3, defense: 0 },
    behavior: {
      attacks: [], idles: [],
      attackAnim: null, runAnim: null, jumpAnim: null,
      hitAnim: null, heavyHitAnim: null,
      hitThreshold: 30, hitDuration: 500,
      detectionRange: 8, attackRange: 48, patrolRange: 3, attackCooldown: 1200,
    },
    persona: {},
    events: {},
    ...overrides,
  };
}

// ── Entity role shorthand helpers ──────────────────────────────────────────────
// SpawnPoint: visual marker for player spawn / respawn position (magenta rect).
// Added automatically by _withSpawn() to any template that has a playerMain entity.
const _spawn = (x, y) => _base({
  name: 'Spawn Point', role: 'spawnPoint',
  position: { x, y },
  renderSize: { width: 32, height: 32 },
});
// ParticleEmitter: visual-only placeholder (cyan rect) until runtime support lands.
const _particle = (name, x, y, w = 32, h = 32) => _base({
  name, role: 'particleEmitter',
  position: { x, y }, renderSize: { width: w, height: h },
  events: {},
});
// SoundEmitter: visual-only placeholder (blue rect) until runtime support lands.
const _sound = (name, x, y) => _base({
  name, role: 'soundEmitter',
  position: { x, y }, renderSize: { width: 28, height: 28 },
  events: {},
});

// Appends a SpawnPoint at the playerMain's position (if present) before returning.
function _withSpawn(entities) {
  const player = entities.find(e => e.role === 'playerMain');
  if (!player) return entities;
  return [...entities, _spawn(player.position.x, player.position.y)];
}

/**
 * Returns an array of pre-configured game entity objects for the given preset.
 * tileW/tileH are the tile size in pixels; cols/rows are the level grid size.
 *
 * IMPORTANT — role names must match what gameRuntime.js looks for:
 *   'playerMain'     → the player character (runtime pins camera + handles input)
 *   'enemy'          → AI-controlled antagonist (patrol, detect, attack)
 *   'collectible'    → item the player picks up (triggers onCollect event)
 *   'tower'          → static attacker (tower defense)
 *   'spawnPoint'     → respawn marker (visual magenta rect; runtime Phase J.2)
 *   'particleEmitter'→ particle system origin (visual cyan rect; runtime Phase J.6)
 *   'soundEmitter'   → ambient/trigger sound (visual blue rect; runtime Phase J.5)
 *   'prop'           → decorative, no logic
 *
 * Ground collision: tileCollide() returns true at y+h > rows*tileH, so the
 * level bottom edge is always solid. No "Ground" entity is needed for physics.
 *
 * Returns [] for fully runtime-managed modes (snake, pac-man, match-3, cards, rhythm).
 * All templates with a playerMain auto-include a SpawnPoint via _withSpawn().
 */
export function buildLevelEntities(presetKey, tileW = 32, tileH = 32, cols = 22, rows = 16) {
  const preset = GAME_PRESETS[presetKey] || null;
  const levelW = cols * tileW;
  const levelH = rows * tileH;
  const groundY = levelH - tileH;           // top of the hard floor row
  const standY  = groundY - 64;             // y for a 64px-tall entity standing on floor
  const centerX = Math.floor(levelW * 0.5);
  const centerY = Math.floor(levelH * 0.5);
  const playerSpeed = preset?.playerStats?.speed || 200;
  const playerRun   = preset?.playerStats?.runSpeed || Math.round(playerSpeed * 1.6);
  const playerJump  = preset?.playerStats?.jumpHeight || 3;

  // ── Classic Mario ─────────────────────────────────────────────────────────────
  if (presetKey === 'platformer.classic-mario') {
    return _withSpawn([
      _base({
        name: 'Player', role: 'playerMain',
        position: { x: 3 * tileW, y: standY },
        renderSize: { width: 48, height: 64 },
        stats: { hp: 100, speed: playerSpeed, runSpeed: playerRun, jumpHeight: playerJump, damage: 10, defense: 0 },
        events: { onDeath: 'lose-life', onDamage: 'flash-screen' },
      }),
      _base({
        name: 'Goomba', role: 'enemy',
        position: { x: Math.floor(levelW * 0.45), y: standY },
        renderSize: { width: 48, height: 48 },
        stats: { hp: 1, speed: 80, runSpeed: 80, jumpHeight: 0, damage: 1, defense: 0 },
        events: { onDeath: 'add-score:200' },
      }),
      _base({
        name: 'Goomba 2', role: 'enemy',
        position: { x: Math.floor(levelW * 0.65), y: standY },
        renderSize: { width: 48, height: 48 },
        stats: { hp: 1, speed: 80, runSpeed: 80, jumpHeight: 0, damage: 1, defense: 0 },
        events: { onDeath: 'add-score:200' },
      }),
      _base({
        name: 'Coin', role: 'collectible',
        position: { x: Math.floor(levelW * 0.35), y: groundY - 3 * tileH },
        renderSize: { width: 28, height: 28 },
        events: { onCollect: 'add-score:100' },
      }),
      _base({
        name: 'Coin 2', role: 'collectible',
        position: { x: Math.floor(levelW * 0.5), y: groundY - 5 * tileH },
        renderSize: { width: 28, height: 28 },
        events: { onCollect: 'add-score:100' },
      }),
      _base({
        name: 'Goal Pole', role: 'collectible',
        position: { x: Math.floor(levelW * 0.9), y: groundY - 5 * tileH },
        renderSize: { width: 32, height: 5 * tileH },
        events: { onCollect: 'next-level' },
      }),
      _particle('Coin Spark', Math.floor(levelW * 0.35), groundY - 3 * tileH, 24, 24),
      _sound('BGM', tileW, tileH),
    ]);
  }

  // ── Endless Runner ─────────────────────────────────────────────────────────────
  // Runtime pins player X to 18% of screen. Obstacles are recycled enemy entities.
  // Lane 0 = ground, lane 1 = mid, lane 2 = top.
  if (presetKey === 'platformer.endless-runner') {
    const obstacleBase = {
      stats: { hp: 2, speed: 0, runSpeed: 0, jumpHeight: 0, damage: 0, defense: 0 },
      behavior: { attacks: [], idles: [], attackRange: 0, detectionRange: 0,
        patrolRange: 0, hitThreshold: 999, hitDuration: 0, attackCooldown: 9999 },
      events: { onDeath: 'add-score:100' },
    };
    return _withSpawn([
      _base({
        name: 'Player', role: 'playerMain',
        position: { x: Math.floor(levelW * 0.18), y: standY },
        renderSize: { width: 48, height: 64 },
        stats: { hp: 3, speed: playerSpeed, runSpeed: playerSpeed, jumpHeight: playerJump, damage: 10, defense: 0 },
        events: { onDeath: 'lose-life' },
      }),
      // Three obstacle types — one anchored per lane (recycled to random lane unless overridden)
      _base({ name: 'Obstacle A', role: 'enemy', runnerLane: 0,
        position: { x: Math.floor(levelW * 0.55), y: standY + 16 },
        renderSize: { width: 48, height: 48 }, ...obstacleBase }),
      _base({ name: 'Obstacle B', role: 'enemy', runnerLane: 1,
        position: { x: Math.floor(levelW * 0.75), y: standY + 16 },
        renderSize: { width: 48, height: 48 }, ...obstacleBase }),
      _base({ name: 'Obstacle C', role: 'enemy', runnerLane: 2,
        position: { x: Math.floor(levelW * 0.90), y: standY + 16 },
        renderSize: { width: 48, height: 48 }, ...obstacleBase }),
      // Collectible coin — recycled to a random lane like obstacles
      _base({ name: 'Coin', role: 'collectible', runnerLane: 'any',
        position: { x: Math.floor(levelW * 0.68), y: standY - tileH },
        renderSize: { width: 28, height: 28 },
        events: { onCollect: 'add-score:50' },
      }),
      _particle('Jump Dust', Math.floor(levelW * 0.18), standY + 48, 40, 16),
    ]);
  }

  // ── Puzzle Platformer ─────────────────────────────────────────────────────────
  if (presetKey === 'platformer.puzzle-platformer') {
    return _withSpawn([
      _base({
        name: 'Player', role: 'playerMain',
        position: { x: 3 * tileW, y: standY },
        renderSize: { width: 48, height: 64 },
        stats: { hp: 100, speed: playerSpeed, runSpeed: playerRun, jumpHeight: playerJump, damage: 0, defense: 0 },
        events: { onDeath: 'restart-level' },
      }),
      _base({
        name: 'Goal Crystal', role: 'collectible',
        position: { x: Math.floor(levelW * 0.85), y: groundY - 4 * tileH },
        renderSize: { width: 40, height: 40 },
        events: { onCollect: 'next-level' },
      }),
    ]);
  }

  // ── Double Jump / Dash / Wall-Jump — generic precision platformer ─────────────
  if (presetKey === 'platformer.double-jump' ||
      presetKey === 'platformer.dash-mechanic' ||
      presetKey === 'platformer.wall-jump') {
    return _withSpawn([
      _base({
        name: 'Player', role: 'playerMain',
        position: { x: 3 * tileW, y: standY },
        renderSize: { width: 48, height: 64 },
        stats: { hp: 100, speed: playerSpeed, runSpeed: playerRun, jumpHeight: playerJump, damage: 10, defense: 0 },
        events: { onDeath: 'lose-life', onDamage: 'flash-screen' },
      }),
      _base({
        name: 'Enemy', role: 'enemy',
        position: { x: Math.floor(levelW * 0.55), y: standY },
        renderSize: { width: 48, height: 48 },
        stats: { hp: 40, speed: 80, runSpeed: 80, jumpHeight: 0, damage: 20, defense: 0 },
        events: { onDeath: 'add-score:100' },
      }),
      _base({
        name: 'Gem', role: 'collectible',
        position: { x: Math.floor(levelW * 0.35), y: groundY - 4 * tileH },
        renderSize: { width: 32, height: 32 },
        events: { onCollect: 'add-score:50' },
      }),
      _base({
        name: 'Gem 2', role: 'collectible',
        position: { x: Math.floor(levelW * 0.7), y: groundY - 6 * tileH },
        renderSize: { width: 32, height: 32 },
        events: { onCollect: 'add-score:50' },
      }),
      _base({
        name: 'Exit Gate', role: 'collectible',
        position: { x: Math.floor(levelW * 0.9), y: groundY - 4 * tileH },
        renderSize: { width: 40, height: 4 * tileH },
        events: { onCollect: 'next-level' },
      }),
    ]);
  }

  // ── Top-Down — Action RPG ──────────────────────────────────────────────────────
  if (presetKey === 'topdown.action-rpg') {
    return _withSpawn([
      _base({
        name: 'Hero', role: 'playerMain',
        position: { x: Math.floor(levelW * 0.15), y: centerY - 32 },
        renderSize: { width: 48, height: 64 },
        stats: { hp: 100, speed: playerSpeed, runSpeed: playerSpeed, jumpHeight: 0, damage: 10, defense: 5 },
        events: { onDeath: 'lose-life', onDamage: 'flash-screen' },
      }),
      _base({
        name: 'Slime', role: 'enemy',
        position: { x: Math.floor(levelW * 0.55), y: centerY - 24 },
        renderSize: { width: 48, height: 48 },
        stats: { hp: 15, speed: 80, runSpeed: 80, jumpHeight: 0, damage: 5, defense: 0 },
        events: { onDeath: 'add-score:50' },
      }),
      _base({
        name: 'Skeleton', role: 'enemy',
        position: { x: Math.floor(levelW * 0.75), y: Math.floor(levelH * 0.65) },
        renderSize: { width: 48, height: 64 },
        stats: { hp: 30, speed: 100, runSpeed: 100, jumpHeight: 0, damage: 10, defense: 0 },
        events: { onDeath: 'add-score:100' },
      }),
      _base({
        name: 'Potion', role: 'collectible',
        position: { x: Math.floor(levelW * 0.4), y: Math.floor(levelH * 0.3) },
        renderSize: { width: 28, height: 36 },
        events: { onCollect: 'add-score:50' },
      }),
      _base({
        name: 'Dungeon Exit', role: 'collectible',
        position: { x: Math.floor(levelW * 0.85), y: Math.floor(levelH * 0.7) },
        renderSize: { width: 48, height: 56 },
        events: { onCollect: 'next-level' },
      }),
      _particle('Hit Sparks', Math.floor(levelW * 0.55), centerY - 24, 24, 24),
      _sound('Dungeon Ambience', tileW, tileH),
    ]);
  }

  // ── Top-Down — Vampire Survivors ───────────────────────────────────────────────
  if (presetKey === 'topdown.vampire-survivors') {
    return _withSpawn([
      _base({
        name: 'Player', role: 'playerMain',
        position: { x: centerX - 24, y: centerY - 32 },
        renderSize: { width: 48, height: 64 },
        stats: { hp: 100, speed: playerSpeed, runSpeed: playerSpeed, jumpHeight: 0, damage: 20, defense: 0 },
        events: { onDeath: 'game-over' },
      }),
      // Initial wave enemies — runtime spawns more in waves
      _base({
        name: 'Bat', role: 'enemy',
        position: { x: Math.floor(levelW * 0.1), y: Math.floor(levelH * 0.15) },
        renderSize: { width: 36, height: 36 },
        stats: { hp: 20, speed: 120, runSpeed: 120, jumpHeight: 0, damage: 5, defense: 0 },
        events: { onDeath: 'add-score:10' },
      }),
      _base({
        name: 'Bat 2', role: 'enemy',
        position: { x: Math.floor(levelW * 0.9), y: Math.floor(levelH * 0.1) },
        renderSize: { width: 36, height: 36 },
        stats: { hp: 20, speed: 120, runSpeed: 120, jumpHeight: 0, damage: 5, defense: 0 },
        events: { onDeath: 'add-score:10' },
      }),
      _base({
        name: 'Bat 3', role: 'enemy',
        position: { x: Math.floor(levelW * 0.15), y: Math.floor(levelH * 0.85) },
        renderSize: { width: 36, height: 36 },
        stats: { hp: 20, speed: 120, runSpeed: 120, jumpHeight: 0, damage: 5, defense: 0 },
        events: { onDeath: 'add-score:10' },
      }),
      _base({
        name: 'Bat 4', role: 'enemy',
        position: { x: Math.floor(levelW * 0.85), y: Math.floor(levelH * 0.85) },
        renderSize: { width: 36, height: 36 },
        stats: { hp: 20, speed: 120, runSpeed: 120, jumpHeight: 0, damage: 5, defense: 0 },
        events: { onDeath: 'add-score:10' },
      }),
      _particle('Death Burst', centerX, centerY, 32, 32),
      _sound('Arena Music', tileW, tileH),
    ]);
  }

  // ── Top-Down — Survival Waves / Generic Top-Down ───────────────────────────────
  if (presetKey.startsWith('topdown.')) {
    const enemyCount = presetKey === 'topdown.collectathon' ? 0 : 2;
    const itemCount  = presetKey === 'topdown.collectathon' ? 5 : 1;
    const entities = [
      _base({
        name: 'Player', role: 'playerMain',
        position: { x: Math.floor(levelW * 0.15), y: centerY - 32 },
        renderSize: { width: 48, height: 64 },
        stats: { hp: 100, speed: playerSpeed, runSpeed: playerSpeed, jumpHeight: 0, damage: 10, defense: 0 },
        events: { onDeath: presetKey === 'topdown.stealth' ? 'game-over' : 'lose-life', onDamage: 'flash-screen' },
      }),
    ];
    for (let i = 0; i < enemyCount; i++) {
      entities.push(_base({
        name: `Enemy ${i + 1}`, role: 'enemy',
        position: { x: Math.floor(levelW * (0.55 + i * 0.2)), y: Math.floor(levelH * (0.4 + i * 0.2)) },
        renderSize: { width: 48, height: 48 },
        stats: { hp: 40, speed: 90, runSpeed: 90, jumpHeight: 0, damage: 15, defense: 0 },
        events: { onDeath: 'add-score:100' },
      }));
    }
    for (let i = 0; i < itemCount; i++) {
      entities.push(_base({
        name: `Item ${i + 1}`, role: 'collectible',
        position: {
          x: Math.floor(levelW * (0.25 + i * 0.15)),
          y: Math.floor(levelH * (0.3 + (i % 2) * 0.35)),
        },
        renderSize: { width: 28, height: 28 },
        events: { onCollect: 'add-score:100' },
      }));
    }
    // Collectathon exit — reach it after grabbing all items to complete the level.
    if (presetKey === 'topdown.collectathon') {
      entities.push(_base({
        name: 'Level Exit', role: 'collectible',
        position: { x: Math.floor(levelW * 0.85), y: Math.floor(levelH * 0.5) },
        renderSize: { width: 48, height: 64 },
        events: { onCollect: 'next-level' },
      }));
    }
    return _withSpawn(entities);
  }

  // ── Fighting — 1v1 Brawler ─────────────────────────────────────────────────────
  if (presetKey === 'fighting.brawler') {
    return _withSpawn([
      _base({
        name: 'Player', role: 'playerMain',
        position: { x: Math.floor(levelW * 0.2), y: standY - 32 },
        renderSize: { width: 80, height: 96 },
        stats: { hp: 100, speed: playerSpeed, runSpeed: playerSpeed, jumpHeight: 3, damage: 25, defense: 10 },
        events: { onDeath: 'game-over' },
      }),
      _base({
        name: 'AI Opponent', role: 'enemy',
        position: { x: Math.floor(levelW * 0.7), y: standY - 32 },
        renderSize: { width: 80, height: 96 },
        facing: 'left',
        stats: { hp: 100, speed: 150, runSpeed: 150, jumpHeight: 3, damage: 20, defense: 5 },
        events: { onDeath: 'next-level' },
      }),
    ]);
  }

  // ── Tower Defense ─────────────────────────────────────────────────────────────
  if (presetKey === 'strategy.tower-defense') {
    return [
      _base({
        name: 'Tower', role: 'tower',
        position: { x: Math.floor(levelW * 0.3), y: Math.floor(levelH * 0.3) },
        renderSize: { width: 64, height: 64 },
        stats: { hp: 500, speed: 0, runSpeed: 0, jumpHeight: 0, damage: 30, defense: 100 },
      }),
      _base({
        name: 'Tower 2', role: 'tower',
        position: { x: Math.floor(levelW * 0.55), y: Math.floor(levelH * 0.6) },
        renderSize: { width: 64, height: 64 },
        stats: { hp: 500, speed: 0, runSpeed: 0, jumpHeight: 0, damage: 30, defense: 100 },
      }),
      _base({
        name: 'Enemy Wave 1', role: 'enemy',
        position: { x: 0, y: centerY - 24 },
        renderSize: { width: 48, height: 48 },
        stats: { hp: 100, speed: 80, runSpeed: 80, jumpHeight: 0, damage: 10, defense: 0 },
        events: { onDeath: 'add-score:10' },
      }),
      _base({
        name: 'Enemy Wave 2', role: 'enemy',
        position: { x: Math.floor(tileW * 1.5), y: centerY + 24 },
        renderSize: { width: 48, height: 48 },
        stats: { hp: 100, speed: 80, runSpeed: 80, jumpHeight: 0, damage: 10, defense: 0 },
        events: { onDeath: 'add-score:10' },
      }),
    ];
  }

  // ── Arcade — Space Invaders ───────────────────────────────────────────────────
  // Runtime _initSpaceInvaders generates the alien grid. Player entity seeds the init.
  if (presetKey === 'arcade.space-invaders') {
    return _withSpawn([
      _base({
        name: 'Ship', role: 'playerMain',
        position: { x: centerX - 24, y: levelH - 3 * tileH },
        renderSize: { width: 48, height: 48 },
        stats: { hp: 3, speed: playerSpeed, runSpeed: playerSpeed, jumpHeight: 0, damage: 10, defense: 0 },
        events: { onDeath: 'lose-life' },
      }),
    ]);
  }

  // ── Arcade — Breakout / Arkanoid ──────────────────────────────────────────────
  if (presetKey === 'arcade.breakout') {
    return _withSpawn([
      _base({
        name: 'Paddle', role: 'playerMain',
        position: { x: Math.floor(levelW * 0.4), y: levelH - 3 * tileH },
        renderSize: { width: 4 * tileW, height: tileH },
        stats: { hp: 1, speed: 300, runSpeed: 300, jumpHeight: 0, damage: 0, defense: 0 },
        events: { onDeath: 'lose-life' },
      }),
    ]);
  }

  // ── Arcade — Pong ─────────────────────────────────────────────────────────────
  if (presetKey === 'arcade.pong') {
    return _withSpawn([
      _base({
        name: 'Player Paddle', role: 'playerMain',
        position: { x: 2 * tileW, y: Math.floor(levelH * 0.4) },
        renderSize: { width: tileW, height: 5 * tileH },
        stats: { hp: 1, speed: 250, runSpeed: 250, jumpHeight: 0, damage: 0, defense: 0 },
        events: { onDeath: 'game-over' },
      }),
    ]);
  }

  // ── Casual — Flappy Bird ──────────────────────────────────────────────────────
  if (presetKey === 'casual.flappy-bird') {
    return _withSpawn([
      _base({
        name: 'Bird', role: 'playerMain',
        position: { x: Math.floor(levelW * 0.2), y: centerY },
        renderSize: { width: 48, height: 40 },
        stats: { hp: 1, speed: 0, runSpeed: 0, jumpHeight: 2, damage: 0, defense: 0 },
        events: { onDeath: 'game-over' },
      }),
    ]);
  }

  // ── Casual — Endless Score Chaser ────────────────────────────────────────────
  if (presetKey === 'casual.endless-score') {
    return _withSpawn([
      _base({
        name: 'Player', role: 'playerMain',
        position: { x: centerX - 24, y: Math.floor(levelH * 0.5) },
        renderSize: { width: 48, height: 48 },
        stats: { hp: 1, speed: playerSpeed, runSpeed: playerSpeed, jumpHeight: 0, damage: 0, defense: 0 },
        events: { onDeath: 'game-over' },
      }),
    ]);
  }

  // ── Racing — Top-Down ────────────────────────────────────────────────────────
  if (presetKey === 'racing.top-down') {
    return _withSpawn([
      _base({
        name: 'Car', role: 'playerMain',
        position: { x: centerX - 24, y: Math.floor(levelH * 0.7) },
        renderSize: { width: 48, height: 80 },
        stats: { hp: 100, speed: playerSpeed, runSpeed: playerSpeed, jumpHeight: 0, damage: 0, defense: 0 },
        events: { onDeath: 'lose-life' },
      }),
    ]);
  }

  // Fully runtime-managed modes — no entity templates needed:
  //   arcade.snake, arcade.pac-man  → grid/cell-based, runtime owns all state
  //   racing.endless                → _initEndlessRoad manages cars via internal state
  //   strategy.match-3              → tile-swap canvas, no entities
  //   card.blackjack / card.solitaire → card canvas, no entities
  //   rhythm.lane-tap               → note lanes, no entities
  return [];
}
