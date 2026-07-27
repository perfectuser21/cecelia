import test from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, readFileSync } from 'node:fs';

test('regression-contract 包含 F1 recovery current-main 基线条目', () => {
  const content = readFileSync('regression-contract.yaml', 'utf8');
  assert.match(content, /KERNEL-F1-RECOVERY-07272204/);
});

test('SYSTEM_MAP 记录同一 Journey 与 current SHA 验收链约束', () => {
  const content = readFileSync('docs/current/SYSTEM_MAP.md', 'utf8');
  assert.match(content, /bb8cc561-b3ee-4fec-b74d-2255694bd963/);
  assert.match(content, /current SHA/);
  assert.match(content, /fresh evaluator/);
});

test('F1 recovery smoke 契约脚本已登记', () => {
  accessSync('packages/brain/scripts/smoke/f1-current-main-reconcile-smoke.sh');
  accessSync('packages/brain/scripts/smoke/f1-ledger-s0-s12-matrix-smoke.sh');
  accessSync('packages/brain/scripts/smoke/f1-regression-equivalence-smoke.sh');
  accessSync('packages/brain/scripts/smoke/f1-fresh-evidence-gate-smoke.sh');
});
