import { closeSync, existsSync, mkdirSync, openSync, unlinkSync, writeFileSync } from 'fs';
import * as path from 'path';

import { getConfig } from '../config';
import { flush } from '../recorder';
import { buildDaxtaSpec, type BuildResult } from './build-spec';

function getBuildLockPath() {
  return path.join(getConfig().outDir, '.build.lock');
}

function tryLock(): number | null {
  try {
    mkdirSync(path.dirname(getBuildLockPath()), { recursive: true });
    return openSync(getBuildLockPath(), 'wx');
  } catch {
    return null;
  }
}

function unlock(fd: number) {
  try {
    closeSync(fd);
  } catch {
    // ignore
  }
  try {
    unlinkSync(getBuildLockPath());
  } catch {
    // ignore
  }
}

function withLock(options: { force?: boolean }, run: () => BuildResult): BuildResult | null {
  let fd = tryLock();
  if (fd == null && options.force) {
    const deadline = Date.now() + 8000;
    while (fd == null && Date.now() < deadline) {
      const pauseUntil = Date.now() + 25;
      while (Date.now() < pauseUntil) {
        // brief spin
      }
      fd = tryLock();
    }
  }
  if (fd == null) return null;

  try {
    return run();
  } finally {
    unlock(fd);
  }
}

export function rebuildFromDisk(options: { silent?: boolean; force?: boolean; html?: boolean } = {}): BuildResult | null {
  return withLock({ force: options.force }, () => {
    const result = buildDaxtaSpec({ silent: options.silent ?? true, html: options.html });
    if (!options.silent && result.changed) {
      console.log(`DAxTA (partial) ${result.hits} hits, ${result.operations} ops — ${result.updated} updated, ${result.unchanged} unchanged`);
    }
    if (result.changed) touchPartialMarker(result);
    return result;
  });
}

export function flushAndRebuild(options: { silent?: boolean; force?: boolean } = {}): BuildResult | null {
  flush();
  return rebuildFromDisk(options);
}

export function touchPartialMarker(result: BuildResult) {
  const marker = path.join(getConfig().outDir, 'partial.json');
  writeFileSync(marker, `${JSON.stringify({ at: new Date().toISOString(), hits: result.hits, operations: result.operations }, null, 2)}\n`);
}

export function clearPartialMarker() {
  const marker = path.join(getConfig().outDir, 'partial.json');
  if (!existsSync(marker)) return;
  try {
    unlinkSync(marker);
  } catch {
    // ignore
  }
}
