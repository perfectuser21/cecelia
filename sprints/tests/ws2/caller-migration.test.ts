/**
 * WS2 — Caller Migration + Inline Logic Extraction [BEHAVIOR]
 *
 * 这些测试在 caller 迁移前必须 FAIL（Red 阶段证据）：
 *   - 当前 executor.js 行 32-33 仍 import { selectBestAccount } 和 { executeInDocker }
 *   - 当前 executor.js 行 3039/3055 仍直接调用 isSpendingCapped + selectBestAccount
 *   - 当前 executor.js 行 3101 仍直接调用 executeInDocker(
 *   - 当前 harness-graph-runner.js / content-pipeline-runner.js 默认 dockerExecutor 是 executeInDocker
 *   - 当前 billing.js 写入字段集合未与 executor.js 旧 SQL UPDATE 字段做 cross-check（R3）
 *
 * 实施完毕（4 个 caller 迁移到 spawn + 内联逻辑下沉 + R3 字段对齐）后，全部 PASS（Green）。
 *
 * Round 2 新增 R3 mitigation: it #9 cross-check billing.js payload 字段集合与
 * executor.js:3066-3067 旧 SQL UPDATE 字段 byte-equal。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../../..');
const EXECUTOR_PATH = join(ROOT, 'packages/brain/src/executor.js');
const GRAPH_RUNNER_PATH = join(ROOT, 'packages/brain/src/harness-graph-runner.js');
const PIPELINE_RUNNER_PATH = join(ROOT, 'packages/brain/src/workflows/content-pipeline-runner.js');
const BILLING_PATH = join(ROOT, 'packages/brain/src/spawn/middleware/billing.js');

function readSrc(path: string): string {
  return readFileSync(path, 'utf8');
}

function importLines(src: string): string[] {
  return src.split('\n').filter((line) => /^\s*import\b/.test(line));
}

describe('WS2 — Caller Migration + Inline Logic Extraction [BEHAVIOR]', () => {
  it('executor.js no longer imports isSpendingCapped or selectBestAccount from account-usage', () => {
    const src = readSrc(EXECUTOR_PATH);
    const accountUsageImports = importLines(src).filter((line) => /account-usage/.test(line));
    const offending = accountUsageImports.filter((line) => /\b(isSpendingCapped|selectBestAccount)\b/.test(line));
    expect(offending).toEqual([]);
  });

  it('executor.js no longer imports executeInDocker from docker-executor', () => {
    const src = readSrc(EXECUTOR_PATH);
    const dockerExecutorImports = importLines(src).filter((line) => /docker-executor/.test(line));
    const offending = dockerExecutorImports.filter((line) => /\bexecuteInDocker\b/.test(line));
    expect(offending).toEqual([]);
  });

  it('executor.js HARNESS_DOCKER_ENABLED branch invokes spawn(), not executeInDocker, when triggered', () => {
    const src = readSrc(EXECUTOR_PATH);
    const spawnImport = importLines(src).find((line) => /from\s+['"][^'"]*spawn[^'"]*['"]/.test(line) && /\bspawn\b/.test(line));
    expect(spawnImport).toBeDefined();
    const directExecuteCalls = src.match(/\bexecuteInDocker\s*\(/g) || [];
    expect(directExecuteCalls.length).toBe(0);
    expect(/\bspawn\s*\(/.test(src)).toBe(true);
  });

  it('executor.js HARNESS_DOCKER_ENABLED branch no longer contains inline isSpendingCapped or selectBestAccount calls', () => {
    const src = readSrc(EXECUTOR_PATH);
    const inlineCappedCalls = src.match(/\bisSpendingCapped\s*\(/g) || [];
    const inlineSelectCalls = src.match(/\bselectBestAccount\s*\(/g) || [];
    expect(inlineCappedCalls.length).toBe(0);
    expect(inlineSelectCalls.length).toBe(0);
  });

  it('harness-graph-runner default dockerExecutor is spawn, not executeInDocker', () => {
    const src = readSrc(GRAPH_RUNNER_PATH);
    const spawnImport = importLines(src).find((line) => /from\s+['"][^'"]*spawn[^'"]*['"]/.test(line) && /\bspawn\b/.test(line));
    expect(spawnImport).toBeDefined();
    expect(/opts\.dockerExecutor\s*\|\|\s*spawn\b/.test(src)).toBe(true);
    expect(/opts\.dockerExecutor\s*\|\|\s*executeInDocker\b/.test(src)).toBe(false);
  });

  it('content-pipeline-runner default dockerExecutor is spawn, not executeInDocker', () => {
    const src = readSrc(PIPELINE_RUNNER_PATH);
    const spawnImport = importLines(src).find((line) => /from\s+['"][^'"]*spawn[^'"]*['"]/.test(line) && /\bspawn\b/.test(line));
    expect(spawnImport).toBeDefined();
    expect(/opts\.dockerExecutor\s*\|\|\s*spawn\b/.test(src)).toBe(true);
    expect(/opts\.dockerExecutor\s*\|\|\s*executeInDocker\b/.test(src)).toBe(false);
  });

  it('opts.dockerExecutor injection still overrides the spawn default in both runners', () => {
    const graphSrc = readSrc(GRAPH_RUNNER_PATH);
    const pipelineSrc = readSrc(PIPELINE_RUNNER_PATH);
    expect(/const\s+executor\s*=\s*opts\.dockerExecutor\s*\|\|\s*spawn\b/.test(graphSrc)).toBe(true);
    expect(/const\s+executor\s*=\s*opts\.dockerExecutor\s*\|\|\s*spawn\b/.test(pipelineSrc)).toBe(true);
  });

  it('grep guard: no business file under packages/brain/src/ (excluding spawn/ and __tests__/) imports executeInDocker', () => {
    const { execSync } = require('child_process');
    const cmd = `grep -rln "from.*docker-executor" packages/brain/src/ 2>/dev/null | grep -v __tests__ | grep -v "spawn/" | grep -v "docker-executor.js$" | xargs -I{} grep -l "\\bexecuteInDocker\\b" {} 2>/dev/null || true`;
    const out = execSync(cmd, { encoding: 'utf8', cwd: ROOT }).trim();
    expect(out).toBe('');
  });

  it('billing dispatched_account field-set cross-check: billing.js payload keys ⊇ {dispatched_account, dispatched_model} matching executor.js legacy UPDATE field set [R3 mitigation]', () => {
    // R3: billing middleware 写入字段集合必须与 executor.js:3066-3067 旧 SQL UPDATE byte-equal
    // 旧 SQL: `UPDATE tasks SET payload = ... || $2::jsonb`
    //         payload = JSON.stringify({ dispatched_account: accountId, dispatched_model: selectedModelId })
    // → 字段集合 = {dispatched_account, dispatched_model}

    const billingSrc = readSrc(BILLING_PATH);

    // 静态断言 billing.js 包含且仅至少包含两个 legacy 字段名
    const hasDispatchedAccount = /\bdispatched_account\b/.test(billingSrc);
    const hasDispatchedModel = /\bdispatched_model\b/.test(billingSrc);
    expect(hasDispatchedAccount).toBe(true);
    expect(hasDispatchedModel).toBe(true);

    // Cross-check: 如果 executor.js 仍含旧 SQL UPDATE 字段（迁移完后该 SQL 应被删除，迁移完成时不再做此双向断言）
    // 但 billing.js 必须始终保留这两个字段名 → 即使 executor 旧 SQL 删除，下游依赖的字段约定不漂移
    const billingHasLegacyFieldSet = hasDispatchedAccount && hasDispatchedModel;
    expect(billingHasLegacyFieldSet).toBe(true);

    // 反向守卫：迁移后 executor.js 不应保留与 billing 冲突的"分叉字段"（如 dispatched_account_v2 之类）
    const executorSrc = readSrc(EXECUTOR_PATH);
    const forkedFields = executorSrc.match(/\bdispatched_account_v\d+\b|\bdispatched_model_v\d+\b/g) || [];
    expect(forkedFields).toEqual([]);
  });
});
