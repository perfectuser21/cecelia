/**
 * dispatch-codex-bridge-preflight.test.js
 *
 * 验证 Codex Bridge dispatch 层在派任务前对端点做存活预检：
 *   - selectBestBridge 全部 unhealthy 时返回 null（不再 fallback 到硬编码 XIAN_CODEX_BRIDGE_URL）
 *   - triggerCodexBridge 在 /run 之前对最终 bridgeUrl 做 /health 预检
 *   - 预检失败返回 { success:false, error: ... } —— dispatcher.js 据此把 task 回 queued，
 *     释放 Codex 并发池 slot，避免向断联端点派任务造成永久死锁
 *
 * 根因：learning_id fdf87ba0 — Codex 端点断联 8 天产生整个并发池永久死锁，
 * 因为旧版 selectBestBridge 在所有 /health 失败时仍返回硬编码 URL，
 * 且 forceBridgeUrl 路径完全跳过 /health 检查。
 *
 * 采用静态源读取 + 正则断言模式（同 executor-codex-review-preflight.test.js），
 * 不实际跑 fetch，CI 不需要起真服务。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const executorSrc = readFileSync(join(__dirname, '../executor.js'), 'utf8');

function getFnBody(src, fnSig) {
  const fnStart = src.indexOf(fnSig);
  if (fnStart < 0) return '';
  const nextFnIdx = src.indexOf('\nasync function ', fnStart + 1);
  return src.slice(fnStart, nextFnIdx > 0 ? nextFnIdx : fnStart + 4000);
}

describe('selectBestBridge: 全部 unhealthy 时不再 fallback 到死端点', () => {
  const fnBody = getFnBody(executorSrc, 'async function selectBestBridge()');

  it('函数存在', () => {
    expect(fnBody.length).toBeGreaterThan(0);
  });

  it('healthy.length === 0 分支返回 null（不是硬编码 URL）', () => {
    const idx = fnBody.indexOf('healthy.length === 0');
    expect(idx).toBeGreaterThan(-1);
    const branch = fnBody.slice(idx, idx + 400);
    expect(branch).toMatch(/return\s+null/);
    // 关键：fallback 分支不再 return XIAN_CODEX_BRIDGE_URL
    expect(branch).not.toMatch(/return\s+XIAN_CODEX_BRIDGE_URL/);
  });
});

describe('triggerCodexBridge: dispatch 前做端点存活预检', () => {
  const fnBody = getFnBody(executorSrc, 'async function triggerCodexBridge(task');

  it('函数存在', () => {
    expect(fnBody.length).toBeGreaterThan(0);
  });

  it('bridgeUrl 为空（selectBestBridge 返回 null）时早返 success:false + no_live_codex_bridge', () => {
    expect(fnBody).toMatch(/if\s*\(\s*!bridgeUrl\s*\)/);
    expect(fnBody).toMatch(/no_live_codex_bridge/);
  });

  it('/run POST 之前对 bridgeUrl 做 /health 预检（防 forceBridgeUrl 路径漏检）', () => {
    const runIdx = fnBody.indexOf('/run');
    expect(runIdx).toBeGreaterThan(-1);
    const beforeRun = fnBody.slice(0, runIdx);
    // 必须有针对 bridgeUrl 的 /health 调用
    expect(beforeRun).toMatch(/fetch\(\s*`\$\{bridgeUrl\}\/health`/);
  });

  it('预检失败返回 success:false + codex_bridge_preflight_failed（不发 /run，让 dispatcher 释放 slot）', () => {
    expect(fnBody).toContain('codex_bridge_preflight_failed');
    // preflight 分支必须有 return { success: false 这种结构
    const preflightIdx = fnBody.indexOf('codex_bridge_preflight_failed');
    expect(preflightIdx).toBeGreaterThan(-1);
    const surroundings = fnBody.slice(Math.max(0, preflightIdx - 200), preflightIdx + 200);
    expect(surroundings).toMatch(/success:\s*false/);
  });

  it('预检使用短超时（避免拖慢 dispatch tick）', () => {
    // /run 之前的 /health 调用应带 AbortSignal.timeout，且超时 ≤ 5000ms
    const runIdx = fnBody.indexOf('/run');
    const beforeRun = fnBody.slice(0, runIdx);
    const healthIdx = beforeRun.lastIndexOf('/health');
    expect(healthIdx).toBeGreaterThan(-1);
    const healthCallBlock = beforeRun.slice(healthIdx, healthIdx + 300);
    const timeoutMatch = healthCallBlock.match(/AbortSignal\.timeout\((\d+)\)/);
    expect(timeoutMatch).not.toBeNull();
    const ms = parseInt(timeoutMatch[1], 10);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(5000);
  });
});
