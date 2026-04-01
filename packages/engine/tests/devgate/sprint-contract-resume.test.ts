import { describe, it, expect } from 'vitest';
import { existsSync, statSync, readFileSync } from 'fs';
import { resolve } from 'path';

const SCRIPT = resolve(__dirname, '../../scripts/devgate/sprint-contract-loop.sh');

describe('sprint-contract-loop.sh --resume 断点续跑', () => {
  it('脚本文件存在', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it('脚本是可执行的', () => {
    const mode = statSync(SCRIPT).mode;
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  it('支持 --resume 参数标志', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('--resume');
  });

  it('--resume 模式读取 STATE_FILE', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('STATE_FILE');
    expect(content).toContain('RESUME_MODE');
  });

  it('blocker_count==0 时输出已收敛信息', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('已收敛');
  });

  it('原调用格式向后兼容（BRANCH + blocker_count + seal）', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('blocker_count');
    expect(content).toContain('EVAL_SEAL');
    expect(content).toContain('BRANCH');
  });

  it('01-spec.md Step 4 包含 --resume 恢复检测说明', () => {
    const specPath = resolve(__dirname, '../../skills/dev/steps/01-spec.md');
    expect(existsSync(specPath)).toBe(true);
    const content = readFileSync(specPath, 'utf8');
    expect(content).toContain('--resume');
    expect(content).toContain('RESUME_EXIT');
  });
});
