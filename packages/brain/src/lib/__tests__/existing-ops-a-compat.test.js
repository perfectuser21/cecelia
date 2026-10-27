import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildExistingOpsSources } from '../existing-ops-source.js';
// 原始 dc40069 RED 已单独运行；永久回归不依赖 squash 后不可达的 PR 对象。
const revision = 'dc40069b10cba9f2b35262db792556342720c207';
const baseRevision = '95d3d6b9647a4accc748a4988f6bcf151d82c55f';
const EXPECTED_A_SHA256 = {
  "packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs": "08ea8d09638e16a03ba2d8018a568b1ba7d54d564b1db06e1fce53d4f594b435",
  "packages/brain/scripts/coding-workflow/__tests__/brain-transport.test.mjs": "21064df7fb38b5b576741cc9a205243cc979e9611b2da27a9e65767b9a93fa8b",
  "packages/brain/scripts/coding-workflow/__tests__/fixtures/brain-fetch-preload.mjs": "8d688215c712e69103cac39915af0e5b19f2fe5ed0d89a8ad47a6f5b940bd6d3",
  "packages/brain/scripts/coding-workflow/__tests__/helpers/brain-transport.mjs": "214bb02459c22dce0b7b32e9c888d7a51526e88862635d1c3c966862b5b813a9",
  "packages/brain/scripts/coding-workflow/__tests__/helpers/git.mjs": "b23dfd004a02c9114c85a1f4dee6478668b2ae50cd9ec7448af77eba20173eea",
  "packages/brain/scripts/coding-workflow/__tests__/helpers/procs.mjs": "087efd3f146fffcc9aa2e9fd21fe87481a2dfc944bd0d73ea2c0e97f1cc6bef7",
  "packages/brain/scripts/coding-workflow/__tests__/helpers/run-activity.mjs": "682838d4fe7c6e648cc7f55d164d53fbd5e1d96b395966a084ab83c6fc8bb55e",
  "packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs": "d595525727dd0451e3b901ab30e5c782d00b86b470a67bb251f922ea6a2569d7",
  "packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs": "6606ad5b37bc47cc9e37d6bc69d9a66ef7454cf4c3ac46654bacabf84c3be6e5",
  "packages/brain/scripts/coding-workflow/activities/intent.mjs": "e0ef92c51c51c257568699a910c2ee3dc4f61be94eaece9ac39b3c9924d60591",
  "packages/brain/scripts/coding-workflow/lib/authority-refs.mjs": "062181701eaea3d9da3bff2683cc302899423571fa7f707c9ed745e19bf0314f",
  "packages/brain/scripts/coding-workflow/lib/guards.mjs": "12e183a7a808e01fb0bfe14bd4a661de253c2621e8fbedc6a7361e7880f813a4",
  "packages/brain/scripts/coding-workflow/lib/intent.mjs": "a3188b06773b1a87f242b6213f5a51c0941dced8f69ef3b0b72ea1c320272a9e",
  "packages/brain/scripts/coding-workflow/lib/invariants.mjs": "577a393a8bf0799c4f3462bf1ebd1188132cfdb365489ba431e92193342ca27f",
  "packages/brain/scripts/coding-workflow/lib/md-chain.mjs": "2c4171cc49357587ab44f2e5813ee195b8b3c56b406f407607dec3480a9636bf",
  "packages/brain/scripts/coding-workflow/new-task.mjs": "52eb3d111adaf373e3962daa903bebd68aa70a689c9b975f3c971def1e09b480",
  "packages/brain/scripts/coding-workflow/runner/__tests__/fixtures/executor-ipc-preload.mjs": "9c0d5724ce430a1a8fc7f7965a6e39f87b2574872444fe8cd54cb10a9f0185f4",
  "packages/brain/scripts/coding-workflow/runner/__tests__/fixtures/fake-executor.mjs": "2a22ed547f96c52580b333df2c3a154947373697fd452617fe1b080c77875ff1",
  "packages/brain/scripts/coding-workflow/runner/__tests__/helpers/owned-processes.mjs": "3b438975dd88bd164de16b34b605dabfaa730db1d9df0de97bb2092a5ae24708",
  "packages/brain/scripts/coding-workflow/runner/__tests__/helpers/sandbox.mjs": "a06c4284f570dce713050aae864c4f6208bb07bdbf77ac7468a37b3cb96d63b0",
  "packages/brain/scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs": "96249730f73b5a5d1017797fa69d9460729048cdf4320bee80c152dea7dceaf9",
  "packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs": "2edba656326badc2377c6618877a3ac19eff0f5b05bacc2bbdc694a8b0b6ad3e",
  "packages/brain/scripts/coding-workflow/runner/lib/repos.mjs": "6a30662a1cc1d852ddba041aac2d01809f73d5ced269a50b69f570260b31aa27",
  "packages/brain/scripts/coding-workflow/runner/run-once.mjs": "b33bd82dc5681ca1c0f69b14e18f6336efd2e0aaa33f5b1a49a3f9e6133ea04f"
};
const paths = [...new Set([...execFileSync('git', ['ls-tree', '-rz', '--full-tree', '--name-only', baseRevision], { encoding: 'utf8', maxBuffer: 32000000 }).split('\0').filter(Boolean), ...Object.keys(EXPECTED_A_SHA256)])];
const cache = new Map();
const readSource = path => {
  if (Object.hasOwn(EXPECTED_A_SHA256, path)) {
    const text = A_ENVELOPES.reviewed[path];
    expect(createHash('sha256').update(text).digest('hex')).toBe(EXPECTED_A_SHA256[path]);
    return text;
  }
  if (!cache.has(path)) cache.set(path, execFileSync('git', ['show', baseRevision + ':' + path], { encoding: 'utf8', maxBuffer: 32000000 }));
  return cache.get(path);
};
it('正式基线Git与独立字节合同重建A模型，真实collector绑定原字节及新增依赖', async () => {
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
import { reviewedAContext } from '../existing-ops-build-source.js';
import { A_ENVELOPES } from '../existing-ops-build-envelopes.js';
const parse = text => acorn(text, { ecmaVersion: 'latest', sourceType: 'module' });
const context = (overrides = {}, missing = []) => reviewedAContext({ parse, revision,
  paths: paths.filter(p => !missing.includes(p)),
  readSource: p => Object.hasOwn(overrides, p) ? overrides[p] : readSource(p) });
const prefix = 'packages/brain/scripts/coding-workflow/';
it('全部A字段独立核dc40069原始字节身份，旧映射来自正式固定基线', () => {
  expect(Object.keys(A_ENVELOPES.reviewed).sort()).toEqual(Object.keys(EXPECTED_A_SHA256).sort());
  for (const [p, source] of Object.entries(A_ENVELOPES.reviewed)) expect(createHash('sha256').update(source).digest('hex')).toBe(EXPECTED_A_SHA256[p]);
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
it('关闭build selector仍精确证明新runtime，不借兼容认领build/stage执行', async () => {
  const schema = 'packages/brain/src/lib/existing-ops-source.js';
  const out = await buildExistingOpsSources({ scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision, paths,
    readSource: p => p === schema ? readSource(p).replace('export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA = 1;', 'export const EXISTING_OPS_BUILD_SELECTOR_SCHEMA = 0;') : readSource(p) });
  const f3 = out.consumers.find(c => c.workflow_key === 'factory_f3_ops');
  expect(f3.status, JSON.stringify(f3.gaps)).toBe('verified');
  expect(f3.input_relations.some(r => r.kind === 'native_node_runner_spawn')).toBe(true);
  expect(f3.input_relations.some(r => r.kind === 'native_build_activity_spawn')).toBe(false);
  expect(f3.bindings.some(b => b.path === prefix + 'activities/build.mjs')).toBe(false);
  expect(f3.bindings.some(b => b.path === prefix + 'activities/intent.mjs')).toBe(false);
}, 120000);
