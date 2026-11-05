import { afterAll, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = vi.hoisted(() => ({ root: null, statusFile: null, roots: [], statusOperations: [] }));
vi.mock('fs', async importOriginal => {
  const actual = await importOriginal();
  const repository = new URL('../../../../../', import.meta.url).pathname.replace(/\/$/, '');
  function ownedPath(path) {
    if (path === '/tmp/cecelia-deploy-status.json') {
      if (!fixture.statusFile) throw Error('deploy fixture has no owned status file');
      fixture.statusOperations.push(fixture.statusFile);
      return fixture.statusFile;
    }
    // 回退用例仍校验真实argv/cwd，只将日志副作用转入本人夹具。
    for (const root of ['/custom/repo/root', repository]) {
      if (typeof path === 'string' && (path === root + '/logs' || path.startsWith(root + '/logs/'))) {
        if (!fixture.root) throw Error('deploy fixture has no owned log directory');
        return fixture.root + path.slice(root.length);
      }
    }
    return path;
  }
  const adapted = { ...actual };
  for (const method of ['readFileSync', 'writeFileSync', 'unlinkSync', 'existsSync', 'mkdirSync', 'openSync', 'statSync']) {
    adapted[method] = (path, ...args) => actual[method](ownedPath(path), ...args);
  }
  return adapted;
});
export const deployFixture = fixture;
beforeEach(() => {
  fixture.root = mkdtempSync(join(tmpdir(), 'brain-deploy-fixture-'));
  fixture.roots.push(fixture.root);
  fixture.statusFile = join(fixture.root, 'status.json');
  fixture.statusOperations = [];
  mkdirSync(join(fixture.root, 'scripts'));
  writeFileSync(join(fixture.root, 'scripts/staging-deploy.sh'), 'owned fixture; never execute');
  vi.stubEnv('REPO_ROOT', fixture.root);
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(() => {
  for (const root of fixture.roots) {
    if (!root.includes('brain-deploy-fixture-')) throw Error('refuse non-owned cleanup');
    rmSync(root, { recursive: true, force: true });
  }
});
