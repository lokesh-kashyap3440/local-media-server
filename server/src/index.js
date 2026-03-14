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
const REPO_ROOT = path.resolve(SERVER_DIR, '..');

const app = express();
const PORT = Number(process.env.PORT || 4000);
const MEDIA_ROOT = process.env.MEDIA_ROOT || '';
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_BIN || 'ffprobe';
const DB_PATH = path.resolve(SERVER_DIR, 'media-db.json');

app.use(cors());
app.use(express.json());

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v']);

const db = {
  media: []
};

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


async function loadDb() {
  try {
    const raw = await fsp.readFile(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.media)) {
      db.media = parsed.media;
    }
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
  return db.media.length;
}

function findMedia(req, res) {
  const media = db.media.find((item) => item.id === req.params.id);
  if (!media) {
    res.status(404).json({ error: 'Media not found' });
    return null;
  }
  return media;
}


app.get('/api/health', (_req, res) => {
  let mediaRootStatus = 'missing';
  if (MEDIA_ROOT) {
    mediaRootStatus = fs.existsSync(path.resolve(MEDIA_ROOT)) ? 'ok' : 'not_found';
  }

  res.json({
    ok: true,
    cwd: REPO_ROOT,
    dbPath: DB_PATH,
    mediaRootStatus,
    indexedItems: db.media.length
  });
});

app.post('/api/library/scan', async (_req, res) => {
  try {
    const count = await scanLibrary();
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/library', (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase();
  const media = query
    ? db.media.filter((item) => item.title.toLowerCase().includes(query) || item.relativePath.toLowerCase().includes(query))
    : db.media;

  res.json({
    media,
    total: media.length
  });
});

app.get('/api/library/:id', (req, res) => {
  const media = findMedia(req, res);
  if (!media) return;
  res.json({ media });
});

app.get('/api/stream/:id', async (req, res) => {
  try {
    const media = findMedia(req, res);
    if (!media) return;

    const filePath = media.path;
    const stat = await fsp.stat(filePath);
    const total = stat.size;
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    const range = parseRange(req.headers.range, total);

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', mimeType);

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
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/transcode/:id', (req, res) => {
  const media = findMedia(req, res);
  if (!media) return;

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Transfer-Encoding', 'chunked');

  const args = [
    '-i', media.path,
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
});

app.listen(PORT, async () => {
  await loadDb();
  console.log(`Media API running at http://localhost:${PORT}`);
});
