# Local Media Server (Plex Alternative)

A local-first media streaming platform using **Node.js + React + FFmpeg**.

## Monorepo Layout

- `server/` – Express API for media indexing, metadata extraction, and streaming/transcoding.
- `client/` – React frontend for browsing libraries and watching media.

## Quick Start

### 1) Install dependencies

```bash
npm install --prefix server
npm install --prefix client
```

### 2) Configure server

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and set `MEDIA_ROOT` to your media directory.

### 3) Start backend + frontend

In two terminals:

```bash
npm run dev --prefix server
npm run dev --prefix client
```

- API: `http://localhost:4000`
- App: `http://localhost:5173`

## Core Features

- Library scan endpoint powered by `ffprobe`
- Media catalog API with optional text query filtering
- Byte-range direct streaming endpoint for local network playback
- Optional on-the-fly transcoding endpoint using `ffmpeg`
- React player UI with searchable media list
- Stable media IDs (based on relative file path) so links survive rescans

## API Overview

- `GET /api/health` – health + index stats + media root status
- `POST /api/library/scan` – scans `MEDIA_ROOT` and refreshes index
- `GET /api/library` – returns indexed media records
- `GET /api/library?q=movie` – filtered list by title/path
- `GET /api/library/:id` – metadata for a single media record
- `GET /api/stream/:id` – direct stream (supports byte-range requests)
- `GET /api/transcode/:id` – progressive MP4 transcoding stream

## Deployment Notes (Internal Infrastructure)

- Put backend behind an internal reverse proxy (Nginx/Caddy).
- Mount shared media storage where the backend can read files.
- Use systemd or container orchestration for process management.
- Keep service private to VPN/LAN.

## Basic Validation

```bash
node --check server/src/index.js
node --test server/src/media-utils.test.js
```

These checks do not require `npm install` and validate core range parsing and ID behavior.
