import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';

const guard = fileURLToPath(new URL('../../test-pyramid-guard.mjs', import.meta.url));
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'pyramid-retired-panel-'));
  let requests = 0;
  const server = createServer((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/api/brain/journey_features/unguarded-count');
    requests++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ count: 0 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await mkdir(join(root, 'scripts'), { recursive: true });
    await mkdir(join(root, 'perm'));
    await writeFile(join(root, 'perm/live.test.js'), 'import {test} from "node:test"; test("live",()=>{});\n');
    const baseline = { orphans: 0, permanent: 1, permanent_roots: [{ path: 'perm', layer: 'unit' }], smoke_dir: 'scripts/smoke', bare_fr: 0 };
    const baselinePath = join(root, 'scripts/test-pyramid-baseline.json');
    await writeFile(baselinePath, JSON.stringify(baseline));
    const preload = join(root, 'owned-http.mjs');
    await writeFile(preload, `import http from 'node:http';
const original = http.get;
http.get = (url, ...args) => {
 if (url !== 'http://localhost:5221/api/brain/journey_features/unguarded-count') throw new Error('unexpected external read');
 return original('http://127.0.0.1:${server.address().port}/api/brain/journey_features/unguarded-count', ...args);
};\n`);
    const run = (json = true) => new Promise((resolve, reject) => {
      const env = { ...process.env, NODE_OPTIONS: '--import=' + pathToFileURL(preload).href };
      delete env.CI;
      execFile(process.execPath, [guard, '--root', root, ...(json ? ['--json'] : [])], { cwd: root, env, timeout: 10000 }, (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error);
        resolve({ code: error?.code ?? 0, stdout, stderr, body: json ? JSON.parse(stdout) : null });
      });
    });
    await fn({ root, baselinePath, baseline, run, requests: () => requests });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

test('local CLI accepts valid tests without retired CURRENT_STATE and reports no active panel', async () => {
  await fixture(async ({ run, requests }) => {
    const result = await run();
    assert.equal(result.code, 0, JSON.stringify(result));
    assert.equal(result.body.pass, true);
    assert.equal(Object.hasOwn(result.body, 'panel'), false);
    const text = await run(false);
    assert.equal(text.code, 0, text.stdout);
    assert.doesNotMatch(text.stdout, /面板|generated=|CURRENT_STATE/);
    assert.equal(requests(), 2);
  });
});

test('retired snapshot cannot hide current pyramid failures', async () => {
  for (const kind of ['orphan', 'unwired-smoke', 'missing-permanent', 'missing-baseline', 'invalid-baseline', 'bare-fr']) {
    await fixture(async ({ root, baselinePath, baseline, run }) => {
      await mkdir(join(root, '.agent-knowledge'));
      await writeFile(join(root, '.agent-knowledge/CURRENT_STATE.md'), 'generated: 2099-01-01 00:00:00\n');
      if (kind === 'orphan') {
        await mkdir(join(root, 'sprints/loose'), { recursive: true });
        await writeFile(join(root, 'sprints/loose/new.test.js'), '');
      }
      if (kind === 'unwired-smoke') {
        await mkdir(join(root, 'scripts/smoke'), { recursive: true });
        await writeFile(join(root, 'scripts/smoke/naked.sh'), 'exit 0\n');
      }
      if (kind === 'missing-permanent') await rm(join(root, 'perm/live.test.js'));
      if (kind === 'missing-baseline') await rm(baselinePath);
      if (kind === 'invalid-baseline') await writeFile(baselinePath, '{broken');
      if (kind === 'bare-fr') await writeFile(baselinePath, JSON.stringify({ ...baseline, bare_fr: -1 }));
      const result = await run();
      assert.notEqual(result.code, 0, kind);
      assert.equal(result.body.pass, false, kind);
      assert.ok(result.body.failures.some(x => x.startsWith(kind === 'orphan' ? 'A1 ' : kind === 'unwired-smoke' ? 'A2 ' : kind === 'missing-permanent' ? 'A3 ' : kind === 'bare-fr' ? 'A5 ' : 'BASELINE:')), JSON.stringify(result));
    });
  }
});
