/**
 * detached-prompt-naming.test.js — 复现 PR #3345 协议断裂回归。
 *
 * 根因：buildDockerArgs 给每次 spawn 生成唯一 runInstance，注入容器 env
 *   CECELIA_PROMPT_FILE=/tmp/cecelia-prompts/${taskId}.${runInstance}.prompt，
 * 但 detached.js 旧版另有一份本地 writePromptFile 写 `${taskId}.prompt`（无 instance）。
 * 容器 entrypoint 按 env 找新名文件 → 不存在 → claude 报
 *   "Input must be provided either through stdin or as a prompt argument" → exit 1。
 *
 * 本测试断言：spawnDockerDetached 实际写到磁盘的 prompt 文件 basename，必须与
 * 最终注入容器的 CECELIA_PROMPT_FILE basename **逐字一致**，且文件内容 == opts.prompt。
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';

// 取证目录隔离到临时目录：必须在 import 被测模块之前设好 env，
// 因为 docker-executor.js 在模块加载时读 HOST_PROMPT_DIR const。
const TMP_PROMPT_DIR = mkdtempSync(path.join(os.tmpdir(), 'detached-prompt-naming-'));
process.env.HOST_PROMPT_DIR = TMP_PROMPT_DIR;
process.env.CECELIA_PROMPT_DIR = TMP_PROMPT_DIR;

// 捕获传给 docker 的 args（含 -e CECELIA_PROMPT_FILE=...）
let capturedArgs = null;
vi.mock('child_process', () => ({
  spawn: (_cmd, args) => {
    capturedArgs = args;
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    queueMicrotask(() => {
      proc.stdout.emit('data', Buffer.from('0123456789abcdef\n'));
      proc.emit('exit', 0);
    });
    return proc;
  },
}));

function envValue(args, key) {
  const hit = args.find((a) => typeof a === 'string' && a.startsWith(`${key}=`));
  return hit ? hit.slice(key.length + 1) : null;
}

describe('spawnDockerDetached 写入路径 == 注入容器 CECELIA_PROMPT_FILE [BEHAVIOR]', () => {
  it('磁盘写入的 prompt 文件 basename 与容器 env 完全一致，内容正确', async () => {
    const { spawnDockerDetached } = await import('../detached.js');

    const taskId = '4795f72e-1111-2222-3333-444455556666';
    const prompt = 'PLANNER PROMPT BODY — 协议断裂复现内容';
    await spawnDockerDetached({
      task: { id: taskId, task_type: 'harness_planner' },
      prompt,
      containerId: 'cecelia-task-detached-test',
    });

    // 1. 容器拿到的 prompt 文件（容器内路径）
    const containerPromptFile = envValue(capturedArgs, 'CECELIA_PROMPT_FILE');
    expect(containerPromptFile).toBeTruthy();
    const basename = path.basename(containerPromptFile);

    // 2. basename 必须含 runInstance 后缀（新协议），绝不是旧的 `${taskId}.prompt`
    expect(basename).toMatch(new RegExp(`^${taskId}\\.[0-9a-f]{6,}\\.prompt$`));
    expect(basename).not.toBe(`${taskId}.prompt`);

    // 3. 宿主侧必须在与 env basename 完全一致的路径写出文件，且内容正确
    const hostFile = path.join(TMP_PROMPT_DIR, basename);
    expect(existsSync(hostFile)).toBe(true);
    expect(readFileSync(hostFile, 'utf8')).toBe(prompt);

    // 4. 旧命名文件不应该是容器要找的那个（防回归）
    const oldNameFile = path.join(TMP_PROMPT_DIR, `${taskId}.prompt`);
    expect(path.basename(containerPromptFile)).not.toBe(path.basename(oldNameFile));
  });
});
