#!/usr/bin/env bash
# 只读真实当前 Git 输入；浅历史可运行，未知来源必须失败关闭。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildExistingOpsSources } from './packages/brain/src/lib/existing-ops-source.js';
import { assertNativeConsumerRuntime } from './packages/brain/src/lib/native-consumer-runtime.js';
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
const proof = await buildExistingOpsSources(options);
assert.equal(proof.consumers.length, 2);
for (const consumer of proof.consumers) {
  assert.equal(consumer.status, 'verified', JSON.stringify(consumer.gaps));
  assert.ok(consumer.bindings.length > 0);
  for (const binding of consumer.bindings)
    assert.equal(binding.content_sha256, createHash('sha256').update(readSource(binding.path)).digest('hex'));
}
const helper = 'packages/brain/scripts/coding-workflow/__tests__/helpers/brain-transport.mjs';
assert.ok(paths.includes(helper));
const broken = await buildExistingOpsSources({ ...options, readSource: path => readSource(path) + (path === helper ? '\nprocess.exit(0);' : '') });
const f3 = broken.consumers.find(c => c.workflow_key === 'factory_f3_ops');
assert.equal(f3.status, 'unknown');
assert.deepEqual(f3.bindings, []);
assert.deepEqual(f3.input_relations, []);
console.log('coding source compatibility: actual Git evidence verified; tampered helper rejected');
JS
