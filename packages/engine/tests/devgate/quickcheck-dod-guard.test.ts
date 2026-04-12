import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Test: quickcheck.sh DoD 守卫
 *
 * 根因：CI harness-contract-lint 因 DoD.md 含未勾选条目失败，
 * 此守卫在本地 push 前拦截，阻止问题到达 CI。
 */
describe('quickcheck.sh DoD 守卫', () => {
  const quickcheckPath = resolve(__dirname, '../../../..', 'scripts/quickcheck.sh');
  const content = readFileSync(quickcheckPath, 'utf8');

  it('包含 DoD 未勾选守卫逻辑', () => {
    expect(content).toContain('DoD 未勾选');
  });

  it('检测 DoD.md 文件存在', () => {
    expect(content).toContain('DoD.md');
  });

  it('计数未勾选条目（- [ ] 模式）', () => {
    // 守卫需要计数 `- [ ]` 格式的未勾选条目
    expect(content).toContain('\\- \\[ \\]');
  });

  it('未勾选时设置 PASS=false', () => {
    expect(content).toContain('PASS=false');
  });

  it('输出错误信息包含条目数量', () => {
    expect(content).toContain('DOD_UNCHECKED');
  });
});

describe('e2e-integrity-check.sh 验证 DoD 守卫', () => {
  const e2ePath = resolve(__dirname, '../../scripts/e2e-integrity-check.sh');
  const content = readFileSync(e2ePath, 'utf8');

  it('包含 quickcheck DoD 守卫检测项', () => {
    expect(content).toContain('quickcheck.sh 包含 DoD 守卫');
  });

  it('包含检测 9 标注', () => {
    expect(content).toContain('检测 9');
  });
});
