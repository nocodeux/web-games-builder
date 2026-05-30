# Web Games Builder

An open-source visual builder for creating web games and interactive UIs. Design screens, add game levels, configure components — then publish directly to the web.

## Features

- Drag-and-drop canvas with auto-layout
- Component library: buttons, forms, data repeaters, frames, overlays, and more
- Game builder: sprite sheets, tile maps, level editor, game runtime
- Multi-screen prototyping with user journey flows
- PostgreSQL persistence with filesystem fallback for local dev
- Publish games/pages to `yourdomain.com/:username/:slug`
- Multiplayer collaboration (WebSockets)
- Mobile API for iOS/native apps

## Quick start

```bash
npm install
cp .env.example .env   # fill in JWT_SECRET at minimum
npm run dev:full        # starts Vite (3001) + Express (3002)
```

Open `http://localhost:3001` — the builder UI.

## Stack

- **Frontend**: React 18, Vite, react-dnd
- **Backend**: Node.js (ESM), Express 4
- **Database**: PostgreSQL (optional — filesystem fallback available)
- **Storage**: Local filesystem or S3-compatible

## License

MIT
