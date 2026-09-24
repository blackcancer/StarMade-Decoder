/** Compare eager and demand-driven first segment, total time and peak RSS in isolated processes. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { registerAllFactories } from '../dist/serializable/Factories.js';
import { parseSmd3, streamSmd3, parseBlueprintFolder, streamBlueprintFolder,
  parseSment, streamSment } from '../dist/smd3/index.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const sources = {
  smd3: path.join(project, 'samples/BASE_Warehouse_Station/DATA/ENTITY_SPACESTATION_BASE_Cargo_Outpost_1772956179377.0.0.0.smd3'),
  folder: path.join(project, 'samples/BASE_Warehouse_Station'),
  sment: path.join(project, 'samples/firestorm class battlecruiser.sment'),
};

async function measure(format, approach) {
  registerAllFactories();
  const source = format === 'sment' && process.env.STARMADE_BENCH_SMENT ?
    process.env.STARMADE_BENCH_SMENT : sources[format];
  const initialRss = process.resourceUsage().maxRSS;
  const start = performance.now();
  let firstSegmentMs = null, count = 0;
  if (approach === 'eager') {
    if (format === 'smd3') {
      const result = parseSmd3(fs.readFileSync(source));
      count = result.segments.length;
    } else {
      const result = format === 'folder' ? parseBlueprintFolder(source) : parseSment(fs.readFileSync(source));
      count = result.entities.reduce((total, entity) => total +
        entity.segments.reduce((sum, region) => sum + region.segments.length, 0), 0);
    }
    firstSegmentMs = count ? performance.now() - start : null;
  } else {
    const events = format === 'smd3' ? streamSmd3(source) : format === 'folder' ?
      streamBlueprintFolder(source) : streamSment(source,
        approach === 'stream-spool' ? { maxBufferedEntryBytes: 0 } :
          approach === 'stream-buffered' ? { maxBufferedEntryBytes: 32 * 1024 * 1024 } : {});
    for await (const event of events) {
      if (event.kind === 'segment') {
        count++;
        firstSegmentMs ??= performance.now() - start;
      }
      if (event.kind === 'end' && event.status !== 'complete') throw new Error(`${format}: ${event.status}`);
    }
  }
  return { format, approach, segments: count,
    firstSegmentMs: Math.round(firstSegmentMs ?? 0), totalMs: Math.round(performance.now() - start),
    peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    peakRssDeltaMiB: Math.round((process.resourceUsage().maxRSS - initialRss) / 1024) };
}

function runCase(format, approach, env = process.env) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--case', format, approach],
    { cwd: project, encoding: 'utf8', maxBuffer: 1024 * 1024, env });
  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    throw new Error(result.error?.message || result.stderr || `${format}/${approach}: child failed`);
  }
  console.log(result.stdout.trim());
}

if (process.argv[2] === '--case') {
  console.log(JSON.stringify(await measure(process.argv[3], process.argv[4])));
} else if (process.argv[2] === '--large') {
  const { default: AdmZip } = await import('adm-zip');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-benchmark-'));
  try {
    const archive = path.join(folder, 'large.sment');
    const zip = new AdmZip();
    const source = sources.smd3;
    zip.addFile('Large/header.smbph', fs.readFileSync(path.join(sources.folder, 'header.smbph')));
    zip.addFile('Large/DATA/Region.smd3', Buffer.concat([fs.readFileSync(source), randomBytes(20 * 1024 * 1024)]));
    fs.writeFileSync(archive, zip.toBuffer());
    for (const approach of ['stream-buffered', 'stream']) {
      runCase('sment', approach, { ...process.env, STARMADE_BENCH_SMENT: archive });
    }
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
} else {
  for (const format of Object.keys(sources)) {
    for (const approach of format === 'sment' ? ['eager', 'stream', 'stream-spool'] : ['eager', 'stream']) {
      runCase(format, approach);
    }
  }
}
