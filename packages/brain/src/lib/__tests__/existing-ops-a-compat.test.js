import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildExistingOpsSources } from '../existing-ops-source.js';
const revision = 'dc40069b10cba9f2b35262db792556342720c207';
const paths = execFileSync('git', ['ls-tree', '-rz', '--full-tree', '--name-only', revision], { encoding: 'utf8', maxBuffer: 32000000 }).split('\0').filter(Boolean);
const cache = new Map();
const readSource = path => {
  if (!cache.has(path)) cache.set(path, execFileSync('git', ['show', revision + ':' + path], { encoding: 'utf8', maxBuffer: 32000000 }));
  return cache.get(path);
};
it('已审 A 固定 Git 新封装通过真实 collector，证据仍绑定实际候选原字节及新增依赖', async () => {
  const out = await buildExistingOpsSources({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision, paths, readSource });
  const f3 = out.consumers.find(c => c.workflow_key === 'factory_f3_ops');
  expect(f3.status, JSON.stringify(f3.gaps)).toBe('verified');
  for (const rel of ['__tests__/helpers/run-activity.mjs', '__tests__/helpers/brain-transport.mjs', '__tests__/fixtures/brain-fetch-preload.mjs', 'runner/__tests__/fixtures/executor-ipc-preload.mjs', 'runner/__tests__/helpers/owned-processes.mjs', 'lib/authority-refs.mjs', 'lib/intent.mjs']) {
    const path = 'packages/brain/scripts/coding-workflow/' + rel;
    expect(f3.bindings.find(b => b.path === path)?.content_sha256).toBe(createHash('sha256').update(readSource(path)).digest('hex'));
    expect(f3.input_relations.some(r => r.input_path === path)).toBe(true);
  }
}, 120000);
