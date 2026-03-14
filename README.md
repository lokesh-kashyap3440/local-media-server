# Local Media Server (Plex Alternative)

A local-first media streaming platform using **Node.js + React + FFmpeg** with a production-ready API baseline and modern UI.

## Monorepo Layout

- `server/` – Express API for media indexing, metadata extraction, streaming, and transcoding.
- `client/` – React frontend for searching libraries and watching media.

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

Set `MEDIA_ROOT` to your media directory.

### 3) Start backend + frontend

```bash
npm run dev --prefix server
npm run dev --prefix client
```

- API: `http://localhost:4000`
- App: `http://localhost:5173`

## Production-grade backend features

- Deterministic media IDs (stable across rescans)
- JSON catalog persistence (`server/media-db.json`)
- CORS + JSON payload limit configuration
- Security response headers (`nosniff`, `referrer-policy`, `corp`)
- Structured JSON request/error logging
- Graceful shutdown handling (`SIGINT`, `SIGTERM`)
- Scan-concurrency protection (`409` when scan already running)
- Path safety validation to ensure streamed/transcoded files stay inside `MEDIA_ROOT`

## Streaming features

- `POST /api/library/scan` – scan and index media with `ffprobe`
- `GET /api/library` – full list
- `GET /api/library?q=keyword` – filtered list
- `GET /api/library/:id` – one media item
- `GET /api/stream/:id` – direct stream with byte-range support
- `GET /api/transcode/:id` – progressive MP4 transcode stream via `ffmpeg`
- `GET /api/health` – readiness + media root status + scan state

## Environment Variables

- `HOST` (default `0.0.0.0`)
- `PORT` (default `4000`)
- `MEDIA_ROOT` (**required**)
- `FFMPEG_BIN` (default `ffmpeg`)
- `FFPROBE_BIN` (default `ffprobe`)
- `CORS_ORIGIN` (default `*`)
- `REQUEST_BODY_LIMIT` (default `64kb`)

## Validation

```bash
node --check server/src/index.js
node --test server/src/media-utils.test.js
npm run test --prefix server
```

> In restricted CI/sandbox environments, these backend checks run without `npm install`.
