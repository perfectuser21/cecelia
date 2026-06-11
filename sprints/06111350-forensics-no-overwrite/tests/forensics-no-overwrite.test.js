/**
 * forensics-no-overwrite.test.js — TDD Red 测试
 * 取证文件防覆盖：cecelia-prompts 按运行实例命名
 *
 * 这些测试在实现前 FAIL（Red），实现后 PASS（Green）。
 *
 * 测试对象:
 *   - packages/brain/src/docker-executor.js — writePromptFile 实例标识格式
 *   - packages/brain/src/docker-executor.js — executeInDocker 在调用 buildDockerArgs 前赋值 opts.env
 *   - docker/cecelia-runner/entrypoint.sh   — CECELIA_PROMPT_FILE 变量引用
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const DOCKER_EXECUTOR_PATH = path.join(REPO_ROOT, 'packages/brain/src/docker-executor.js');
const ENTRYPOINT_PATH = path.join(REPO_ROOT, 'docker/cecelia-runner/entrypoint.sh');

// mock DB — docker-executor.js 在 module load 时 import db.js（Pool 懒连接，不影响测试）
// 使用固定路径字符串（vi.mock 会被提升，不能用运行时变量）
vi.mock('/workspace/packages/brain/src/db.js', () => ({
  default: { query: vi.fn() },
}));

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'forensics-no-ow-'));
  process.env.CECELIA_PROMPT_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.CECELIA_PROMPT_DIR;
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ——— BEHAVIOR:1 — writePromptFile 文件名含实例标识 ———

describe('BEHAVIOR:1 — writePromptFile 生成含实例标识的文件名', () => {
  it('【RED】返回路径 basename 不再是旧格式 {taskId}.prompt', async () => {
    vi.resetModules();
    const { __test__ } = await import(DOCKER_EXECUTOR_PATH);

    const p = __test__.writePromptFile('be1-forensics', 'content');
    const base = path.basename(p);

    // 当前实现返回 'be1-forensics.prompt'（固定格式）→ 这条断言 FAIL
    expect(base).not.toBe('be1-forensics.prompt');
  });

  it('【RED】返回路径 basename 匹配 {taskId}.{ts10+}-{hex8}.prompt 格式', async () => {
    vi.resetModules();
    const { __test__ } = await import(DOCKER_EXECUTOR_PATH);

    const p = __test__.writePromptFile('be1-format', 'content');
    const base = path.basename(p);

    // 期望新格式：be1-format.1749600000123-a1b2c3d4.prompt
    // 当前实现返回 'be1-format.prompt' → regex 不匹配 → 这条断言 FAIL
    expect(base).toMatch(/^be1-format\.\d{10,}-[0-9a-f]{8}\.prompt$/);
  });
});

// ——— BEHAVIOR:2 — 两次写入不覆盖 ———

describe('BEHAVIOR:2 — 两次写入同一 taskId 产出独立文件', () => {
  it('【RED】两次调用 writePromptFile 返回不同路径', async () => {
    vi.resetModules();
    const { __test__ } = await import(DOCKER_EXECUTOR_PATH);

    const p1 = __test__.writePromptFile('be2-overlap', 'content-run-1');
    await new Promise(r => setTimeout(r, 20));
    const p2 = __test__.writePromptFile('be2-overlap', 'content-run-2');

    // 当前实现两次都返回 '{tmpDir}/be2-overlap.prompt' → p1 === p2 → FAIL
    expect(p1).not.toBe(p2);
  });

  it('【RED】第一次写入的内容在第二次写入后仍然完整', async () => {
    vi.resetModules();
    const { __test__ } = await import(DOCKER_EXECUTOR_PATH);

    const p1 = __test__.writePromptFile('be2-preserve', 'content-original');
    await new Promise(r => setTimeout(r, 20));
    __test__.writePromptFile('be2-preserve', 'content-overwrite');

    // 当前实现第二次写会覆盖 p1 的内容 → readFileSync 返回 'content-overwrite' → FAIL
    expect(readFileSync(p1, 'utf8')).toBe('content-original');
  });
});

// ——— BEHAVIOR:3 — executeInDocker 调用链：env 注入前置赋值（Round-2 修复）———
//
// Round-1 BEHAVIOR:3 只验证 buildDockerArgs 能透传手工预填的 opts.env（假设 executeInDocker 已赋值）。
// 实际上 Generator 可以实现 buildDockerArgs 透传但忘记在 executeInDocker 内赋值，导致假绿。
// Round-2 改为静态分析 executeInDocker 函数体，验证赋值语句出现在 buildDockerArgs(opts 调用之前。

describe('BEHAVIOR:3 — executeInDocker 调用链：opts.env 注入在 buildDockerArgs 调用前', () => {
  it('【RED】executeInDocker 源码在调用 buildDockerArgs(opts 前有 opts.env.CECELIA_PROMPT_FILE 赋值语句', () => {
    const src = readFileSync(DOCKER_EXECUTOR_PATH, 'utf8');

    const execFnStart = src.indexOf('export async function executeInDocker(');
    expect(execFnStart, 'executeInDocker 函数必须存在').toBeGreaterThan(-1);

    const buildIdx = src.indexOf('buildDockerArgs(opts', execFnStart);
    expect(buildIdx, 'buildDockerArgs(opts 必须在 executeInDocker 内被调用').toBeGreaterThan(execFnStart);

    const before = src.substring(execFnStart, buildIdx);
    // 过滤注释行（// 和 * 开头）
    const nonComment = before.split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');

    // 当前实现 executeInDocker 只调用 writePromptFile 但不把返回的路径赋给 opts.env → FAIL
    expect(
      nonComment,
      'executeInDocker 在调用 buildDockerArgs 前必须给 opts.env 赋值 CECELIA_PROMPT_FILE'
    ).toMatch(/opts\.env(\.|(\[['"]))\s*CECELIA_PROMPT_FILE/);
  });

  it('【RED】executeInDocker 源码在调用 buildDockerArgs(opts 前有 opts.env.CECELIA_STDOUT_FILE 赋值语句', () => {
    const src = readFileSync(DOCKER_EXECUTOR_PATH, 'utf8');

    const execFnStart = src.indexOf('export async function executeInDocker(');
    const buildIdx = src.indexOf('buildDockerArgs(opts', execFnStart);
    const before = src.substring(execFnStart, buildIdx);
    const nonComment = before.split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');

    // 当前实现无 CECELIA_STDOUT_FILE 赋值 → FAIL
    expect(
      nonComment,
      'executeInDocker 在调用 buildDockerArgs 前必须给 opts.env 赋值 CECELIA_STDOUT_FILE'
    ).toMatch(/opts\.env(\.|(\[['"]))\s*CECELIA_STDOUT_FILE/);
  });
});

// ——— BEHAVIOR:4 — entrypoint.sh env 协议 ———

describe('BEHAVIOR:4 — entrypoint.sh 从 CECELIA_PROMPT_FILE / CECELIA_STDOUT_FILE 读路径', () => {
  it('【RED】entrypoint.sh 包含 CECELIA_PROMPT_FILE 变量引用', () => {
    const entrypoint = readFileSync(ENTRYPOINT_PATH, 'utf8');

    // 当前 entrypoint.sh 使用固定 PROMPT_FILE="${CECELIA_TASK_ID}.prompt" → 不含 CECELIA_PROMPT_FILE → FAIL
    expect(entrypoint).toContain('CECELIA_PROMPT_FILE');
  });

  it('【RED】entrypoint.sh 包含 CECELIA_STDOUT_FILE 变量引用', () => {
    const entrypoint = readFileSync(ENTRYPOINT_PATH, 'utf8');

    // 当前 entrypoint.sh 不含 CECELIA_STDOUT_FILE → FAIL
    expect(entrypoint).toContain('CECELIA_STDOUT_FILE');
  });

  it('【RED】entrypoint.sh 中 CECELIA_PROMPT_FILE 使用 fallback 语法（${VAR:-...}）', () => {
    const entrypoint = readFileSync(ENTRYPOINT_PATH, 'utf8');

    // 当前不含此行 → FAIL；向后兼容要求有 fallback
    expect(entrypoint).toMatch(/CECELIA_PROMPT_FILE:-/);
  });
});
