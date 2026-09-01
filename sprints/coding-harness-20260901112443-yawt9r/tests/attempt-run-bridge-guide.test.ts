import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';

function readGuide(): string {
  try {
    return readFileSync(guidePath, 'utf8');
  } catch {
    return '';
  }
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('说明两个端点及各自用途', () => {
    const text = readGuide();
    expect(text).toMatch(/[\u4e00-\u9fff]/u);
    expect(text).toContain('POST /api/brain/harness/attempt-run');
    expect(text).toMatch(/POST[^\n]*(创建|发起)[^\n]*(派发|attempt)/i);
    expect(text).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(text).toMatch(/GET[^\n]*(按 id|查询)[^\n]*(状态|attempt-run)/i);
  });

  it('说明鉴权与凭据安全', () => {
    const text = readGuide();
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toMatch(/宿主机|宿主/);
    expect(text).toMatch(/远端/);
    expect(text).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
    expect(text).toMatch(/不得[^\n]*(展示|写入)[^\n]*真实 token/i);
    expect(text).not.toMatch(/CECELIA_INTERNAL_TOKEN\s*=\s*[A-Za-z0-9_-]{12,}/);
  });

  it('列全九项角色白名单', () => {
    const text = readGuide();
    expect(text).toMatch(/角色白名单/);
    const roles = ['planner', 'proposer', 'critic', 'generator', 'generator-fix', 'evaluator', 'evaluator-fix', 'judge', 'reporter'];
    for (const role of roles) expect(text).toContain(`\`${role}\``);
  });

  it('说明 payload 必填与 base_sha 省略语义', () => {
    const text = readGuide();
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(text).toMatch(new RegExp(`(?:${field}[^\\n]{0,40}必填|必填[^\\n]{0,40}${field})`));
    }
    expect(text).toMatch(/base_sha[^\n]{0,40}(可省略|选填)/);
    expect(text).toMatch(/生产 Brain[^\n]{0,40}自解析/);
  });

  it('说明三对象派发失败自动回滚', () => {
    const text = readGuide();
    expect(text).toMatch(/派发失败[^\n]{0,80}自动回滚|自动回滚[^\n]{0,80}派发失败/);
    expect(text).toMatch(/run\s*(?:→|->)\s*failed/);
    expect(text).toMatch(/session\s*(?:→|->)\s*closed/);
    expect(text).toMatch(/task\s*(?:→|->)\s*cancelled/);
  });
});

