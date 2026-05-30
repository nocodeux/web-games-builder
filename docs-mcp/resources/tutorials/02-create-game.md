# Tutorial: Create a TUIFY Game

Games use `kind: "world"` screens with a game runtime. The runtime is a pure-JS game loop that handles physics, entities, tiles, and HUD.

---

## Screen types

| kind | Purpose |
|------|---------|
| `"screen"` | Regular app screen (UI components only) |
| `"world"` | Game screen — has levels, entities, tile maps, runtime |

A project can mix both types. Common pattern: a `"screen"` for the main menu and `"world"` for gameplay.

---

## Game screen structure

```json
{
  "id": "screen-game",
  "name": "Game",
  "kind": "world",
  "worldSettings": {
    "genre": "platformer",
    "subtype": "classic-mario",
    "hud": {
      "showScore": true,
      "showLives": true,
      "showCoins": true,
      "showTimer": false
    },
    "mobileControls": "platformer"
  },
  "levels": [ ... ],
  "rows": []
}
```

For a game screen, `rows` is typically empty (the runtime fills the canvas).

---

## Available genres and subtypes

### Platformer
- `classic-mario` — Side-scroller, gravity, jump on enemies
- `endless-runner` — Auto-moves right, tap to jump
- `puzzle-platformer` — Low gravity, deliberate movement
- `double-jump` — Two jump heights
- `dash-mechanic` — Horizontal dash ability
- `wall-jump` — Jump off walls

### Top-Down
- `action-rpg` — Zelda-like, 8-directional movement, melee
- `vampire-survivors` — Auto-attack, XP, wave survival
- `survival-waves` — Wave spawner, manual attack
- `collectathon` — Collect items, no combat
- `stealth` — Low detection, hide mechanic

### Arcade
- `space-invaders`, `pac-man`, `snake`, `breakout`, `pong`

### Casual
- `flappy-bird` — Tap to flap
- `endless-score` — Score chaser

### Racing
- `top-down` — Bird's eye car racing
- `endless` — Endless road runner

### Rhythm
- `lane-tap` — Guitar Hero lane tapping

### Fighting
- `brawler` — 1v1 side-view combat

---

## Level structure

```json
{
  "id": "level-1",
  "name": "World 1-1",
  "gravity": 1200,
  "width": 3200,
  "height": 480,
  "background": "#1a0a2e",
  "entities": [ ... ],
  "tileLayers": [ ... ],
  "colliderShapes": []
}
```

**gravity:** 0 = top-down (no physics), 1200 = platformer default

---

## Entity structure

```json
{
  "id": "player-1",
  "role": "player",
  "x": 100,
  "y": 300,
  "width": 24,
  "height": 32,
  "stats": {
    "hp": 3,
    "speed": 300,
    "runSpeed": 480,
    "jumpHeight": 4
  },
  "defaultAnimation": "idle",
  "animations": [
    {
      "id": "anim-idle",
      "name": "idle",
      "spriteSheetId": "sheet-player",
      "animName": "idle"
    },
    {
      "id": "anim-walk",
      "name": "walk",
      "spriteSheetId": "sheet-player",
      "animName": "walk"
    }
  ]
}
```

**Roles:** `player`, `enemy`, `collectible`, `platform`, `npc`, `projectile`, `hazard`

**stats:**
- `hp` — hit points
- `speed` — walk speed (px/s)
- `runSpeed` — dash/run speed (px/s)
- `jumpHeight` — jump height in tiles (1 tile = tileSize px)
- `damage` — damage dealt on contact

---

## Tile layer structure

```json
{
  "id": "layer-ground",
  "name": "Ground",
  "tilesetId": "tileset-grass",
  "tileSize": 32,
  "solid": true,
  "zIndex": 0,
  "data": [
    [0, 0, 0, 1, 1, 1],
    [0, 0, 0, 2, 2, 2],
    [1, 1, 1, 2, 2, 2]
  ]
}
```

`data` is a 2D array of tile IDs. `0` = empty. IDs > 0 reference tiles in the linked tileset (1-indexed).

---

## HUD text binding

In a game screen, Text components can bind to live game values:

```json
{
  "id": "txt-score",
  "type": "Text",
  "props": {
    "text": "SCORE: {value}",
    "bindTo": "score",
    "fontSize": 14,
    "sizing": { "widthMode": "hug", "heightMode": "hug" }
  },
  "children": []
}
```

Available `bindTo` values: `score`, `lives`, `coins`, `timer`, `xp`, `xpLevel`, `wave`

---

## Complete minimal platformer example

```json
{
  "id": "platformer-demo",
  "name": "Platformer Demo",
  "theme": "theme-retro",
  "viewMode": "mobile",
  "currentScreenId": "screen-menu",
  "database": { "tables": [], "data": {} },
  "screens": [
    {
      "id": "screen-menu",
      "name": "Main Menu",
      "rows": [
        {
          "id": "row-main",
          "layout": { "direction": "column", "align": "center", "justify": "center", "gap": 16, "paddingTop": 120 },
          "children": [
            {
              "id": "txt-title",
              "type": "Text",
              "props": { "text": "SUPER JUMP", "fontSize": 28, "alignment": "center", "textColor": "var(--accent)", "sizing": { "widthMode": "hug", "heightMode": "hug" } },
              "children": []
            },
            {
              "id": "btn-play",
              "type": "Button",
              "props": { "text": "PLAY", "action": "screen", "targetScreenId": "screen-game", "sizing": { "widthMode": "hug", "heightMode": "hug" } },
              "children": []
            }
          ]
        }
      ]
    },
    {
      "id": "screen-game",
      "name": "Game",
      "kind": "world",
      "worldSettings": {
        "genre": "platformer",
        "subtype": "classic-mario",
        "hud": { "showScore": true, "showLives": true, "showCoins": true },
        "mobileControls": "platformer"
      },
      "rows": [],
      "levels": [
        {
          "id": "level-1",
          "name": "Level 1",
          "gravity": 1200,
          "width": 3200,
          "height": 480,
          "background": "#1a0a2e",
          "entities": [
            {
              "id": "player",
              "role": "player",
              "x": 100,
              "y": 380,
              "width": 24,
              "height": 32,
              "stats": { "hp": 3, "speed": 300, "runSpeed": 480, "jumpHeight": 4 },
              "defaultAnimation": "idle",
              "animations": []
            }
          ],
          "tileLayers": [],
          "colliderShapes": []
        }
      ]
    }
  ]
}
```

---

## Mobile control layouts

| mobileControls | Best for |
|----------------|---------|
| `"platformer"` | D-pad left/right + jump button |
| `"topdown-action"` | D-pad 8-dir + attack button |
| `"arcade-shooter"` | D-pad + fire button |
| `"tap-only"` | Single tap action (Flappy Bird) |
| `"none"` | Keyboard/desktop only |
