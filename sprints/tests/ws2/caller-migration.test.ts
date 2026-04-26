/**
 * WS2 — Caller Migration + Inline Logic Extraction [BEHAVIOR]
 *
 * 这些测试在 caller 迁移前必须 FAIL（Red 阶段证据）：
 *   - 当前 executor.js 行 32-33 仍 import { selectBestAccount } 和 { executeInDocker }
 *   - 当前 executor.js 行 3039/3055 仍直接调用 isSpendingCapped + selectBestAccount
 *   - 当前 executor.js 行 3101 仍直接调用 executeInDocker(
 *   - 当前 harness-graph-runner.js / content-pipeline-runner.js 默认 dockerExecutor 是 executeInDocker
 *
 * 实施完毕（4 个 caller 迁移到 spawn + 内联逻辑下沉）后，全部 PASS（Green）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../../..');
const EXECUTOR_PATH = join(ROOT, 'packages/brain/src/executor.js');
const GRAPH_RUNNER_PATH = join(ROOT, 'packages/brain/src/harness-graph-runner.js');
const PIPELINE_RUNNER_PATH = join(ROOT, 'packages/brain/src/workflows/content-pipeline-runner.js');

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
});
