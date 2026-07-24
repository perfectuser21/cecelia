import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const reviewScript = resolve(repoRoot, 'scripts/review-preview.sh');

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopIfAlive(pid) {
  if (!pid || !isAlive(pid)) return;
  process.kill(pid, 'SIGTERM');
}

describe('review-preview process ownership', () => {
  it('does not kill an unrelated process that already owns the requested port', async () => {
    const distDir = mkdtempSync(`${tmpdir()}/review-preview-dist-`);
    writeFileSync(resolve(distDir, 'index.html'), '<!doctype html><title>test</title>');

    const unrelated = spawn(
      process.execPath,
      ['-e', `
        const http = require('node:http');
        const server = http.createServer((_req, res) => res.end('unrelated'));
        server.listen(0, '127.0.0.1', () => console.log(server.address().port));
      `],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const [chunk] = await once(unrelated.stdout, 'data');
    const port = Number(String(chunk).trim());
    const pidFile = `/tmp/review-preview-${port}.pid`;
    if (existsSync(pidFile)) unlinkSync(pidFile);

    let spawnedPreviewPid = null;
    try {
      const result = spawnSync(
        'bash',
        [reviewScript, String(port), '9999', distDir],
        { encoding: 'utf8', timeout: 15_000 },
      );
      if (existsSync(pidFile)) {
        spawnedPreviewPid = Number(readFileSync(pidFile, 'utf8').trim());
      }

      expect(result.status, result.stderr).not.toBe(0);
      expect(isAlive(unrelated.pid)).toBe(true);
    } finally {
      stopIfAlive(spawnedPreviewPid);
      stopIfAlive(unrelated.pid);
      if (existsSync(pidFile)) unlinkSync(pidFile);
      rmSync(distDir, { recursive: true, force: true });
    }
  }, 20_000);
});
