/**
 * executor-codex-review-preflight.test.js
 *
 * 验证 triggerCodexReview spawn 前对 codex binary 的存在性预检：
 * - codex binary 不存在 → fs.access 抛 ENOENT → 不调 spawn → 不发 FAIL callback
 * - 返回 { success: false, configError: true, ... }，dispatcher 据此跳过 cecelia-run breaker
 *
 * 根因：Brain 容器无 codex CLI，spawn 异步触发 child.on('error') ENOENT，
 * 早期实现发 status='AI Failed' callback。callback-processor 已隔离 codex-review 不 trip
 * cecelia-run breaker，但若 preparePrompt 同步异常（容器内 WORK_DIR / fs 错误）会让
 * triggerCodexReview catch 路径返回 { success: false }，dispatcher 仍 trip breaker。
 *
 * 防御层：spawn 前显式 fs.access 预检，缺失即返回 configError，dispatcher 识别后跳过 breaker 计数。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const executorSrc = readFileSync(
  join(__dirname, '../executor.js'),
  'utf8'
);

describe('triggerCodexReview: codex binary 存在性预检', () => {
  function getFnBody(src, fnSig) {
    const fnStart = src.indexOf(fnSig);
    if (fnStart < 0) return '';
    const nextFnIdx = src.indexOf('\nasync function ', fnStart + 1);
    return src.slice(fnStart, nextFnIdx > 0 ? nextFnIdx : fnStart + 4000);
  }

  it('triggerCodexReview 函数体内 spawn 前调用 fs access 预检 codexBin', () => {
    const fnBody = getFnBody(executorSrc, 'async function triggerCodexReview(task)');
    expect(fnBody.length).toBeGreaterThan(0);
    const spawnIdx = fnBody.indexOf('spawn(codexBin');
    expect(spawnIdx).toBeGreaterThan(-1);
    const beforeSpawn = fnBody.slice(0, spawnIdx);
    // 必须有 access(codexBin 调用（fs.promises.access 或 fsAccess(codexBin)）
    expect(beforeSpawn).toMatch(/access\(\s*codexBin/);
  });

  it('codex binary 缺失返回 configError: true（不抛 spawn 也不发 FAIL callback）', () => {
    const fnBody = getFnBody(executorSrc, 'async function triggerCodexReview(task)');
    expect(fnBody).toContain('configError: true');
  });

  it('configError 返回点之前不发 execution-callback（避免 false FAIL 计数）', () => {
    const fnBody = getFnBody(executorSrc, 'async function triggerCodexReview(task)');
    const configErrIdx = fnBody.indexOf('configError: true');
    expect(configErrIdx).toBeGreaterThan(-1);
    // configError 返回点之前的 600 字节内不应有 execution-callback fetch 调用
    const before = fnBody.slice(Math.max(0, configErrIdx - 600), configErrIdx);
    expect(before).not.toContain('execution-callback');
  });

  it('CODEX_BIN env 优先于硬编码默认值（容器路径 vs host 路径）', () => {
    expect(executorSrc).toContain('process.env.CODEX_BIN');
    // host fallback 仍是 /opt/homebrew/bin/codex（兼容本机开发）
    expect(executorSrc).toContain('/opt/homebrew/bin/codex');
  });
});

describe('Dockerfile / docker-compose 配置闭环', () => {
  const dockerfileSrc = readFileSync(
    join(__dirname, '../../Dockerfile'),
    'utf8'
  );
  const composeSrc = readFileSync(
    join(__dirname, '../../../../docker-compose.yml'),
    'utf8'
  );

  it('Dockerfile Stage 2 安装 @openai/codex', () => {
    expect(dockerfileSrc).toMatch(/npm install -g @openai\/codex/);
  });

  it('docker-compose.yml mount /Users/administrator/.codex-team1 read-only', () => {
    expect(composeSrc).toContain('/Users/administrator/.codex-team1:/Users/administrator/.codex-team1:ro');
  });

  it('docker-compose.yml 设置 CODEX_BIN env 指向容器内路径', () => {
    expect(composeSrc).toContain('CODEX_BIN=/usr/local/bin/codex');
  });

  it('docker-compose.yml 设置 CODEX_HOME env', () => {
    expect(composeSrc).toContain('CODEX_HOME=/Users/administrator/.codex-team1');
  });
});
