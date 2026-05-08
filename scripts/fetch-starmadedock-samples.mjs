#!/usr/bin/env node
/**
 * @fileoverview StarMadeDock Sample Fetcher
 *
 * Downloads allowlisted StarMadeDock retrocompatibility samples declared in the
 * repository manifest while enforcing host and file-size safety checks.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Fetch allowlisted StarMadeDock samples declared in
 * samples/retrocompat/starmadedock/manifest.json.
 *
 * This script is intentionally manifest-driven: it does not crawl the site and
 * it enforces a per-file size cap to avoid accidental huge downloads.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';

const root = path.resolve('samples/retrocompat/starmadedock');
const manifestPath = path.join(root, 'manifest.json');
const maxBytes = Number(process.env.STARMADEDOCK_MAX_BYTES ?? 25_000_000);

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'StarMade-Decoder retrocompat fetcher' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(get(next));
        return;
      }
      if ((res.statusCode ?? 500) >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new Error(`download exceeds cap (${maxBytes} bytes): ${url}`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
  });
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
fs.mkdirSync(root, { recursive: true });

for (const sample of manifest.samples) {
  if (!/^https:\/\/starmadedock\.net\/content\//.test(sample.download)) {
    throw new Error(`refusing non-StarMadeDock URL for ${sample.id}: ${sample.download}`);
  }
  if (sample.filename.includes('..') || path.isAbsolute(sample.filename)) {
    throw new Error(`unsafe filename for ${sample.id}: ${sample.filename}`);
  }

  const out = path.join(root, sample.filename);
  if (fs.existsSync(out) && fs.statSync(out).size === sample.bytes) {
    console.log(`ok ${sample.id}: already present (${sample.bytes} bytes)`);
    continue;
  }

  console.log(`fetch ${sample.id}: ${sample.download}`);
  const data = await get(sample.download);
  if (sample.bytes && data.length !== sample.bytes) {
    throw new Error(`size mismatch for ${sample.id}: expected ${sample.bytes}, got ${data.length}`);
  }
  fs.writeFileSync(out, data);
  console.log(`wrote ${out} (${data.length} bytes)`);
}
