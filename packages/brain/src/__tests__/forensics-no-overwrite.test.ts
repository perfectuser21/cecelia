import './helpers/forensics-effects';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
let __test__: any;
let ownedDir: string;

// docker-executor 在模块加载时捕获目录，必须先配置，再导入真模块。
beforeAll(async () => {
  ownedDir = mkdtempSync(path.join(tmpdir(), 'forensics-vt-'));
  vi.stubEnv('CECELIA_PROMPT_DIR', ownedDir);
  vi.stubEnv('HOST_PROMPT_DIR', ownedDir);
  vi.resetModules();
  // @ts-ignore — 运行时 __test__ 导出（JS 模块无类型声明）
  ({ __test__ } = await import('../docker-executor.js'));
});
afterAll(() => {
  // helper 先清理全部登记目录；这里核验真实清理，并恢复调用者环境。
  try {
    expect(existsSync(ownedDir)).toBe(false);
  } finally {
    vi.unstubAllEnvs();
  }
});

describe('取证文件按运行实例唯一命名 [BEHAVIOR]', () => {
  it('同一 taskId 两次写 prompt 取证返回不同路径（不覆盖）', () => {
    const t = 'vt-task-1';
    const p1 = __test__.writePromptFile(t, 'A');
    const p2 = __test__.writePromptFile(t, 'B');
    expect(p1).not.toBe(p2);
    expect(path.basename(p1).startsWith(t)).toBe(true);
    expect(p1.endsWith('.prompt')).toBe(true);
    expect(path.dirname(p1)).toBe(ownedDir);
    expect(path.dirname(p2)).toBe(ownedDir);
    expect(readFileSync(p1, 'utf8')).toBe('A');
    expect(readFileSync(p2, 'utf8')).toBe('B');
  });

  it('buildDockerArgs 注入 CECELIA_PROMPT_FILE 且三类路径共享实例后缀', () => {
    const r = __test__.buildDockerArgs({
      task: { id: 'vt-task-2', task_type: 'dev' }, prompt: 'p',
      worktreePath: ownedDir, minimalHostMounts: true,
    }, {
      homedir: ownedDir, existsSyncFn: () => false,
      readFileSyncFn: () => { throw new Error('禁止读取真实凭据'); },
    });
    expect(r.envFinal.CECELIA_PROMPT_FILE).toBeTruthy();
    const m = String(r.envFinal.CECELIA_PROMPT_FILE).match(/vt-task-2\.([0-9a-f]{6,})\.prompt$/);
    expect(m).not.toBeNull();
    const inst = (m as RegExpMatchArray)[1];
    expect(String(r.cidfile)).toContain('.' + inst + '.cid');
    expect(String(r.envFinal.CECELIA_STDOUT_FILE)).toContain('.' + inst + '.stdout');
    expect(path.dirname(r.cidfile)).toBe(ownedDir);
    expect(path.dirname(r.forensics.promptFile)).toBe(ownedDir);
    expect(path.dirname(r.forensics.stdoutFile)).toBe(ownedDir);
    expect(r.args).toContain(ownedDir + ':/tmp/cecelia-prompts:rw');
  });
});
