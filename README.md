# Retro Board

A real-time, facilitator-controlled retrospective board for local networks. No cloud, no accounts — just run it and share the URL with your team. Multiple boards can run simultaneously, each with its own short code.

## Quick start

```bash
npm install
npm start
```

Open `http://localhost:7179` in your browser. Share the LAN URL (e.g. `http://192.168.x.x:7179`) with teammates on the same network.

Create a new board or join an existing one with a board code (e.g. `r-7H3K9`).

## Development

```bash
npm run dev
```

Starts two processes concurrently: Vite dev server on port 5173 (with HMR) proxying to the Node server on port 7179.

## Features

- **Multi-board** — Each retro gets a unique short code (`r-XXXXX`). Create or join boards from the landing page.
- **Phase-gated flow** — Admin controls four phases: Write → Reveal → Vote → Discuss
- **Anonymous writing** — During the Write phase participants only see their own cards; others' cards are hidden until the admin reveals them
- **Named participants** — Each person enters their name on join; admin sees names in the participant list
- **Voting** — Admin sets max votes per person and whether multiple votes on one card are allowed
- **Live timer** — Admin sets a countdown (1–15 min) visible to everyone in the header
- **Real-time sync** — All changes broadcast instantly over WebSocket
- **Persistent state** — Each board survives server restarts (stored in `boards/<uuid>.json`)
- **Export** — Admin exports the board as Markdown at any time
- **Accessible** — WCAG AA contrast, keyboard navigation, focus trap in modals, screen-reader announcements

## Admin controls

| Control | Description |
|---|---|
| Phase switcher | Move between Write / Reveal / Vote / Discuss |
| Max votes | How many votes each participant gets |
| Multi-vote per card | Allow stacking votes on one card |
| Writing in Reveal | Let participants keep adding cards after reveal |
| Timer | Countdown with Start / Pause / Reset |
| Participant list | See names, mute or kick individuals |
| Copy admin link | Share a URL that grants admin to whoever opens it |
| Clear all | Wipe all cards and votes for this board |
| Export | Download board as Markdown |

## Admin identity

The first browser to connect to a board becomes admin. The role is tied to a token stored in `localStorage` (namespaced per board code) — refreshing the page restores admin. If the admin disconnects, the next person to join is auto-promoted.

To hand off admin: click **Copy admin link** and send it to the new facilitator.

## Running on a custom port

```bash
PORT=3000 npm start
```

## Background mode

```bash
npm run start:bg   # starts in background, saves PID to .pid
npm run stop       # stops the background process
```

## Project structure

```
retro/
├── server.js              # Entry point — wires HTTP + WebSocket
├── server/
│   ├── boards.js          # Board class, lazy load/unload, persistence
│   ├── codes.js           # Short code generation (Crockford base32)
│   ├── http.js            # HTTP request handler (API + static + SPA fallback)
│   ├── migrate.js         # One-shot migration from legacy data.json
│   └── ws.js              # WebSocket message handler
├── client/
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── types.ts
│       ├── utils.ts
│       ├── routing.tsx
│       ├── pages/
│       │   ├── Landing.tsx
│       │   └── Board.tsx
│       ├── components/
│       │   ├── Modal.tsx
│       │   └── ConfirmDialog.tsx
│       ├── hooks/
│       │   ├── useRetroWS.ts
│       │   └── useFocusTrap.ts
│       └── styles.css
├── boards/                # Auto-created; one JSON file per board + index.json
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Requirements

- Node.js 18+
- LAN network (Wi-Fi or wired) shared with participants

## Migrating from v1

If you have an existing `data.json` from the single-board version, it will be automatically migrated to `boards/` on first start. The server logs the new board URL. Your old admin token is preserved.
