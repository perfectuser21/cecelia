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

import { parse as acorn } from 'acorn';
import { reviewedAContext } from '../existing-ops-a-compat.js';
import { A_ENVELOPES } from '../existing-ops-a-envelopes.js';
const parse = text => acorn(text, { ecmaVersion: 'latest', sourceType: 'module' });
const context = (overrides = {}, missing = []) => reviewedAContext({ parse, revision,
  paths: paths.filter(p => !missing.includes(p)),
  readSource: p => Object.hasOwn(overrides, p) ? overrides[p] : readSource(p) });
const prefix = 'packages/brain/scripts/coding-workflow/';
it('全部冻结新源码来自固定 A Git，旧映射来自固定基线而非模型生成', () => {
  for (const [p, source] of Object.entries(A_ENVELOPES.reviewed)) expect(source).toBe(readSource(p));
  for (const [p, source] of Object.entries(A_ENVELOPES.legacy)) expect(source).toBe(execFileSync('git', ['show', '95d3d6b9647a4accc748a4988f6bcf151d82c55f:' + p], { encoding: 'utf8' }));
});
for (const path of Object.keys(A_ENVELOPES.reviewed)) {
  it(path + ' 缺失、插入未审代码均拒绝整组', async () => {
    expect(await context({}, [path])).toBeNull();
    expect(await context({ [path]: readSource(path) + '\nprocess.exit(0);' })).toBeNull();
  });
}
for (const path of Object.keys(A_ENVELOPES.legacy)) it(path + ' 新旧混配拒绝', async () => {
  expect(await context({ [path]: A_ENVELOPES.legacy[path] })).toBeNull();
});
const mutations = [
  ['runner/__tests__/helpers/sandbox.mjs', '[...args, RUN_ONCE]', '[...args, FAKE_EXECUTOR]'],
  ['__tests__/helpers/run-activity.mjs', 'transport.attach?.(child);', ''],
  ['__tests__/helpers/run-activity.mjs', '...(transport.args || [])', "...['--eval', 'process.exit(0)']"],
  ['__tests__/intent.test.mjs', "it('payload.acceptance 优先", "it.skip('payload.acceptance 优先"],
  ['__tests__/helpers/brain-transport.mjs', "target.origin !== url", 'false'],
  ['runner/__tests__/fixtures/executor-ipc-preload.mjs', 'args?.[0] !== executor', 'false'],
  ['activities/intent.mjs', '!sameAuthority(authority, input.authority)', 'false'],
  ['activities/intent.mjs', '!commitAvailable(input.worktree, initialBase)', 'false'],
  ['lib/authority-refs.mjs', "GIT_NO_REPLACE_OBJECTS: '1'", "GIT_NO_REPLACE_OBJECTS: '0'"],
];
for (const [rel, before, after] of mutations) it(rel + ' 语义篡改拒绝: ' + before, async () => {
  const p = prefix + rel, source = readSource(p);
  expect(source).toContain(before);
  expect(await context({ [p]: source.replace(before, after) })).toBeNull();
});
it('证明后读回变化不能套旧证明，注释保持AST但绑定原始字节', async () => {
  const p = prefix + '__tests__/helpers/run-activity.mjs';
  const bytes = '// harmless comment\n' + readSource(p), ctx = await context({ [p]: bytes });
  expect(ctx).not.toBeNull();
  expect(ctx.normalize(p, bytes)).toBe(A_ENVELOPES.legacy[p]);
  expect(() => ctx.normalize(p, readSource(p))).toThrow('reviewed_a_source_changed');
  await expect(ctx.record({ read: readSource, relations: [] })).rejects.toThrow('reviewed_a_source_changed');
});
it('坏支持依赖在真实collector中仍unknown且无部分成功绑定', async () => {
  const p = prefix + '__tests__/fixtures/brain-fetch-preload.mjs';
  const out = await buildExistingOpsSources({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision, paths,
    readSource: path => readSource(path) + (path === p ? '\nprocess.exit(0);' : '') });
  const f3 = out.consumers.find(c => c.workflow_key === 'factory_f3_ops');
  expect(f3.status).toBe('unknown'); expect(f3.bindings).toEqual([]); expect(f3.input_relations).toEqual([]);
}, 120000);
