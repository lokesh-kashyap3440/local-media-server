import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mime from 'mime-types';
import { parseRange, stableMediaId } from './media-utils.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';
const MEDIA_ROOT = process.env.MEDIA_ROOT || '';
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_BIN || 'ffprobe';
const DB_PATH = path.resolve(SERVER_DIR, 'media-db.json');
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const REQUEST_BODY_LIMIT = process.env.REQUEST_BODY_LIMIT || '64kb';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v']);
const db = { media: [] };
let scanInProgress = false;

function log(level, message, extra = {}) {
  console.log(
    JSON.stringify({
      level,
      message,
      time: new Date().toISOString(),
      ...extra
    })
  );
}

function safeMediaRoot() {
  if (!MEDIA_ROOT) {
    throw new Error('MEDIA_ROOT is not configured.');
  }

  const resolved = path.resolve(MEDIA_ROOT);
  if (!fs.existsSync(resolved)) {
    throw new Error(`MEDIA_ROOT does not exist: ${resolved}`);
  }

  return resolved;
}

function assertMediaPathSafe(mediaRoot, filePath) {
  const resolvedPath = path.resolve(filePath);
  const relative = path.relative(mediaRoot, resolvedPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Requested file is outside MEDIA_ROOT.');
  }
  return resolvedPath;
}

async function loadDb() {
  try {
    const raw = await fsp.readFile(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    db.media = Array.isArray(parsed.media) ? parsed.media : [];
  } catch {
    db.media = [];
  }
}

async function saveDb() {
  await fsp.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

async function* walk(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else {
      yield fullPath;
    }
  }
}

function ffprobe(filePath) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration,size:stream=codec_name,width,height',
      '-of', 'json',
      filePath
    ];

    const proc = spawn(FFPROBE_BIN, args);
    let out = '';

    proc.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });

    proc.on('error', () => resolve({}));
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(out));
      } catch {
        resolve({});
      }
    });
  });
}

async function scanLibrary() {
  if (scanInProgress) {
    const conflict = new Error('Scan already in progress.');
    conflict.statusCode = 409;
    throw conflict;
  }

  scanInProgress = true;
  const startedAt = Date.now();

  try {
    const mediaRoot = safeMediaRoot();
    const results = [];

    for await (const filePath of walk(mediaRoot)) {
      const ext = path.extname(filePath).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(ext)) {
        continue;
      }

      const stat = await fsp.stat(filePath);
      const relativePath = path.relative(mediaRoot, filePath);
      const probe = await ffprobe(filePath);
      const stream = Array.isArray(probe.streams)
        ? probe.streams.find((item) => item.width || item.height) || {}
        : {};

      results.push({
        id: stableMediaId(relativePath),
        title: path.basename(filePath, ext),
        ext,
        path: filePath,
        relativePath,
        size: stat.size,
        durationSec: Number(probe?.format?.duration || 0),
        codec: stream.codec_name || null,
        width: stream.width || null,
        height: stream.height || null,
        updatedAt: stat.mtime.toISOString()
      });
    }

    db.media = results.sort((a, b) => a.title.localeCompare(b.title));
    await saveDb();

    return {
      count: db.media.length,
      elapsedMs: Date.now() - startedAt
    };
  } finally {
    scanInProgress = false;
  }
}

function findMediaById(id) {
  return db.media.find((item) => item.id === id) || null;
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: CORS_ORIGIN }));
  app.use(express.json({ limit: REQUEST_BODY_LIMIT }));

  app.use((req, res, next) => {
    req.startedAt = Date.now();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.on('finish', () => {
      log('info', 'request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - req.startedAt
      });
    });
    next();
  });

  app.get('/api/health', (_req, res) => {
    let mediaRootStatus = 'missing';
    if (MEDIA_ROOT) {
      mediaRootStatus = fs.existsSync(path.resolve(MEDIA_ROOT)) ? 'ok' : 'not_found';
    }

    res.json({
      ok: true,
      mediaRootStatus,
      indexedItems: db.media.length,
      scanInProgress,
      uptimeSec: Number(process.uptime().toFixed(1))
    });
  });

  app.post('/api/library/scan', async (_req, res, next) => {
    try {
      const result = await scanLibrary();
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/library', (req, res) => {
    const query = String(req.query.q || '').trim().toLowerCase();
    const media = query
      ? db.media.filter((item) => item.title.toLowerCase().includes(query) || item.relativePath.toLowerCase().includes(query))
      : db.media;

    res.json({ media, total: media.length });
  });

  app.get('/api/library/:id', (req, res) => {
    const media = findMediaById(req.params.id);
    if (!media) {
      res.status(404).json({ error: 'Media not found' });
      return;
    }
    res.json({ media });
  });

  app.get('/api/stream/:id', async (req, res, next) => {
    try {
      const media = findMediaById(req.params.id);
      if (!media) {
        res.status(404).json({ error: 'Media not found' });
        return;
      }

      const mediaRoot = safeMediaRoot();
      const filePath = assertMediaPathSafe(mediaRoot, media.path);
      const stat = await fsp.stat(filePath);
      const total = stat.size;
      const mimeType = mime.lookup(filePath) || 'application/octet-stream';
      const range = parseRange(req.headers.range, total);

      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

      if (!range) {
        res.setHeader('Content-Length', total);
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      res.writeHead(206, {
        'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
        'Content-Length': range.end - range.start + 1
      });

      fs.createReadStream(filePath, range).pipe(res);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/transcode/:id', (req, res, next) => {
    try {
      const media = findMediaById(req.params.id);
      if (!media) {
        res.status(404).json({ error: 'Media not found' });
        return;
      }

      const mediaRoot = safeMediaRoot();
      const filePath = assertMediaPathSafe(mediaRoot, media.path);

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('Cache-Control', 'no-store');

      const args = [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', filePath,
        '-movflags', 'frag_keyframe+empty_moov+faststart',
        '-preset', 'veryfast',
        '-vcodec', 'libx264',
        '-acodec', 'aac',
        '-f', 'mp4',
        'pipe:1'
      ];

      const ff = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      ff.on('error', () => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to start ffmpeg process.' });
        }
      });

      ff.stdout.pipe(res);
      ff.stderr.on('data', () => {});

      req.on('close', () => {
        ff.kill('SIGKILL');
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, _next) => {
    const status = Number(error.statusCode) || 500;
    log('error', 'request_failed', {
      method: req.method,
      path: req.path,
      status,
      message: error.message
    });

    res.status(status).json({ error: status >= 500 ? 'Internal server error' : error.message });
  });

  return app;
}

const app = createApp();
const server = app.listen(PORT, HOST, async () => {
  await loadDb();
  log('info', 'server_started', { host: HOST, port: PORT, dbPath: DB_PATH });
});

function shutdown(signal) {
  log('info', 'shutdown_signal', { signal });
  server.close(() => {
    log('info', 'server_stopped');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { createApp, scanLibrary, safeMediaRoot };
