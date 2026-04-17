# Retro Board

A real-time, facilitator-controlled retrospective board for local networks. No cloud, no accounts — just run it and share the URL with your team.

## Quick start

```bash
npm install
npm start
```

Open the printed URL in your browser. Share the LAN URL (e.g. `http://192.168.x.x:7179`) with teammates on the same network.

The **first person** to open the URL becomes the admin.

## Features

- **Phase-gated flow** — Admin controls four phases: Write → Reveal → Vote → Discuss
- **Anonymous writing** — During the Write phase participants only see their own cards; others' cards are hidden until the admin reveals them
- **Named participants** — Each person enters their name on join; admin sees names in the participant list, cards stay anonymous to others
- **Voting** — Admin sets max votes per person and whether multiple votes on one card are allowed
- **Live timer** — Admin sets a countdown (1–15 min) visible to everyone in the header
- **Real-time sync** — All changes broadcast instantly over WebSocket
- **Persistent state** — Board survives server restarts (stored in `data.json`)
- **Export** — Admin exports the board as Markdown at any time

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
| Clear all | Wipe all cards and votes |
| Export | Download board as Markdown |

## Admin identity

The first browser to connect becomes admin. The role is tied to a token stored in `localStorage` — refreshing the page restores admin. If the admin is away for more than 10 minutes with no active connection, the next person to join is auto-promoted.

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
├── server.js          # Node.js HTTP + WebSocket server
├── package.json
├── data.json          # Auto-created; persists board state
└── public/
    ├── index.html     # Page shell (loads React via CDN)
    ├── app.jsx        # React app (all components)
    └── styles.css     # Styles
```

## Requirements

- Node.js 18+
- LAN network (Wi-Fi or wired) shared with participants
