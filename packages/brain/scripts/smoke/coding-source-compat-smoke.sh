#!/usr/bin/env bash
# 当前 Git 的旧业务 + 独立原字节合同约束的离线 A 样本；不执行样本代码。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildExistingOpsSources } from './packages/brain/src/lib/existing-ops-source.js';
import { A_ENVELOPES } from './packages/brain/src/lib/existing-ops-build-envelopes.js';
import { assertNativeConsumerRuntime } from './packages/brain/src/lib/native-consumer-runtime.js';
const hash = text => createHash('sha256').update(text).digest('hex');
const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const revision = git(['rev-parse', 'HEAD']).trim();
const paths = git(['ls-tree', '-rz', '--full-tree', '--name-only', revision]).split('\0').filter(Boolean);
const cache = new Map();
const readSource = path => {
  if (!cache.has(path)) cache.set(path, git(['show', revision + ':' + path]));
  return cache.get(path);
};
await assertNativeConsumerRuntime(readSource);
const options = { scope: 'cecelia-factory', repo: 'perfectuser21/cecelia', revision, paths, readSource };
async function verified(input) {
  const proof = await buildExistingOpsSources(input);
  assert.equal(proof.consumers.length, 2);
  for (const consumer of proof.consumers) {
    assert.equal(consumer.status, 'verified', JSON.stringify(consumer.gaps));
    assert.ok(consumer.bindings.length > 0);
    for (const binding of consumer.bindings)
      assert.equal(binding.content_sha256, hash(input.readSource(binding.path)));
  }
}
await verified(options);
// 摘要独立从原 dc40069 Git 的逐文件原字节取得，不由被测结果生成期望值。
const contract = Object.keys(A_ENVELOPES.reviewed).sort().map(path => [path, hash(A_ENVELOPES.reviewed[path])]);
assert.equal(hash(JSON.stringify(contract)), 'f1f38c22eabde5118c88fcfb3a0074fc1a11afa6a84eaa372eea6411c704d48f');
const modelRead = path => Object.hasOwn(A_ENVELOPES.reviewed, path) ? A_ENVELOPES.reviewed[path] : readSource(path);
const model = { ...options, paths: [...new Set([...paths, ...Object.keys(A_ENVELOPES.reviewed)])], readSource: modelRead };
await verified(model);
const helper = 'packages/brain/scripts/coding-workflow/__tests__/helpers/brain-transport.mjs';
const broken = await buildExistingOpsSources({ ...model, readSource: path => modelRead(path) + (path === helper ? '\nprocess.exit(0);' : '') });
const f3 = broken.consumers.find(c => c.workflow_key === 'factory_f3_ops');
assert.equal(f3.status, 'unknown');
assert.deepEqual(f3.bindings, []);
assert.deepEqual(f3.input_relations, []);
console.log('source compatibility: actual Git and fixed offline A model verified; tampered model rejected');
JS
