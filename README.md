# EZELEN

Het klassieke Nederlandse reactiekaartspel, online. Schuif kaarten door naar links, verzamel vier dezelfde en sla zelf op tafel. Zodra iemand slaat, slaat iedereen; wie als laatste reageert krijgt een letter. Wie als eerste E-Z-E-L vol heeft is de ezel en doet een opdracht. Gemaakt door Artnomad, gebouwd op het Kingsen-platform (room + socket-laag).

3 tot 8 spelers, getuned voor 6+. Mobiel-first. Huisstijl: "Veld en Mandarijn" (smaragdgroen vilt, mandarijn-oranje, alarm-roze tijdens de race). Fraunces + Inter. Nederlands en Engels.

## Structuur

- **Client** (repo-root): Vite + React. Echte speelkaarten, Artnomad-intro met geluid, taalkeuze, naam + foto (cropper), geluidseffecten, eigen-opdracht of door-de-game.
- **`server/`**: autoritatieve in-memory room-server (WebSocket + HTTP-polling fallback). Geen database. De server bezit het kaartspel en elke hand; clients zien alleen hun eigen hand plus ieders aantallen (per-viewer state, dus niet te cheaten). Eerlijke race via klok-synchronisatie.

## Lokaal draaien

```bash
# server
cd server && npm install && PORT=8787 node server.js
# client (in een tweede terminal)
npm install
VITE_EZELEN_WS=ws://localhost:8787/ws npm run dev   # http://localhost:5180
```

## Deploy

Twee Coolify-apps op Hetzner (zoals Kings):
- client -> `ezelen.artnomad.nl` (Docker, dit niveau; `.env.production` bakt de WS-URL in)
- server -> `ezelen-api.artnomad.nl` (Docker, `server/`)

`*.artnomad.nl` wijst al naar de server; Traefik routeert op host.
