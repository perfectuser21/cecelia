import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-ignore — 运行时 __test__ 导出（JS 模块无类型声明）
import { __test__ } from '../../../packages/brain/src/docker-executor.js';

// 把取证写到临时目录，避免污染 /tmp/cecelia-prompts
beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'forensics-vt-'));
  process.env.CECELIA_PROMPT_DIR = dir;
  process.env.HOST_PROMPT_DIR = dir;
});

describe('取证文件按运行实例唯一命名 [BEHAVIOR]', () => {
  it('同一 taskId 两次写 prompt 取证返回不同路径（不覆盖）', () => {
    const t = 'vt-task-1';
    const p1 = __test__.writePromptFile(t, 'A');
    const p2 = __test__.writePromptFile(t, 'B');
    expect(p1).not.toBe(p2);
    expect(path.basename(p1).startsWith(t)).toBe(true);
    expect(p1.endsWith('.prompt')).toBe(true);
  });

  it('buildDockerArgs 注入 CECELIA_PROMPT_FILE 且三类路径共享实例后缀', () => {
    const r = __test__.buildDockerArgs({ task: { id: 'vt-task-2', task_type: 'dev' }, prompt: 'p' });
    expect(r.envFinal.CECELIA_PROMPT_FILE).toBeTruthy();
    const m = String(r.envFinal.CECELIA_PROMPT_FILE).match(/vt-task-2\.([0-9a-f]{6,})\.prompt$/);
    expect(m).not.toBeNull();
    const inst = (m as RegExpMatchArray)[1];
    expect(String(r.cidfile)).toContain('.' + inst + '.cid');
    expect(String(r.envFinal.CECELIA_STDOUT_FILE)).toContain('.' + inst + '.stdout');
  });
});
