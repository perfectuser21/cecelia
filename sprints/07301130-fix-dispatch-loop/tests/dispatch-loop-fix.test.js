/**
 * dispatch-loop-fix.test.js — 刀(cc28d1af) sprint 合同测试（vitest 包装器）
 * 真实执行两个 bash 测试（真调 cecelia-run.sh / brain-deploy.sh，无 mock）。
 * Red 阶段：修复未实现 → bash 测试红 → 本测试红。
 */
import { test, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

test('根因A：cecelia-run 软链调用 launcher 路径真实存在', () => {
  const r = spawnSync('bash', [resolve(REPO_ROOT, 'packages/brain/scripts/__tests__/cecelia-run-symlink.test.sh')], { encoding: 'utf8', timeout: 30000 });
  expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
});

test('根因D：brain-deploy 成功路径含 drain-cancel', () => {
  const r = spawnSync('bash', [resolve(REPO_ROOT, 'scripts/__tests__/brain-deploy-drain-cancel.test.sh')], { encoding: 'utf8', timeout: 30000 });
  expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
});
