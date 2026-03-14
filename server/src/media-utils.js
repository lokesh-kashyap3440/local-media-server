import crypto from 'node:crypto';

export function stableMediaId(relativePath) {
  return crypto.createHash('sha1').update(relativePath).digest('hex').slice(0, 12);
}

export function parseRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
  if (!match) return null;

  const [, startRaw, endRaw] = match;

  if (!startRaw && !endRaw) return null;

  if (!startRaw && endRaw) {
    const suffixLen = Number(endRaw);
    if (Number.isNaN(suffixLen) || suffixLen <= 0) return null;
    const start = Math.max(0, size - suffixLen);
    return { start, end: size - 1 };
  }

  const start = Number(startRaw);
  if (Number.isNaN(start) || start >= size) return null;

  const end = endRaw ? Number(endRaw) : size - 1;
  if (Number.isNaN(end) || end < start) return null;

  return { start, end: Math.min(end, size - 1) };
}
