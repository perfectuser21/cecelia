import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const guidePath = 'docs/current/attempt-run-bridge-guide.md';
const allowedRoles = [
  'canary',
  'planner',
  'proposer',
  'reviewer',
  'generator',
  'generator-fix',
  'evaluator',
  'evaluator-evidence-repair',
  'judge',
];

function guide(): string {
  return readFileSync(guidePath, 'utf8');
}

describe('attempt-run 桥接使用说明合同', () => {
  it('POST 端点独立说明提交用途与 internalAuthOrLoopback 鉴权边界', () => {
    const text = guide();
    const section = text.match(/### POST \/api\/brain\/harness\/attempt-run([\s\S]*?)(?=\n### |\n## |$)/u)?.[1] ?? '';
    expect(section).toMatch(/提交|派发/u);
    expect(section).toContain('internalAuthOrLoopback');
    expect(section).toMatch(/loopback[^\n]*(免于|无需)[^\n]*(Bearer|令牌)/iu);
    expect(section).toMatch(/宿主|远端/u);
    expect(section).toContain('Authorization: Bearer CECELIA_INTERNAL_TOKEN');
  });

  it('GET 端点独立说明按 id 查询用途与 internalAuthOrLoopback 鉴权边界', () => {
    const text = guide();
    const section = text.match(/### GET \/api\/brain\/harness\/attempt-run\/:id([\s\S]*?)(?=\n### |\n## |$)/u)?.[1] ?? '';
    expect(section).toMatch(/按[^\n]*id[^\n]*查询/u);
    expect(section).toContain('internalAuthOrLoopback');
    expect(section).toMatch(/loopback[^\n]*(免于|无需)[^\n]*(Bearer|令牌)/iu);
    expect(section).toMatch(/宿主|远端/u);
    expect(section).toContain('Authorization: Bearer CECELIA_INTERNAL_TOKEN');
  });

  it('角色白名单精确等于九个权威角色且无别名', () => {
    const text = guide();
    const roleSection = text.match(/## 角色白名单([\s\S]*?)(?=\n## |$)/u)?.[1] ?? '';
    const documented = [...roleSection.matchAll(/^\s*-\s+`([^`]+)`\s*$/gmu)].map((m) => m[1]);
    expect(documented).toEqual(allowedRoles);
  });

  it('payload 独立断言三个必填字段与 base_sha 可选自解析语义', () => {
    const text = guide();
    const payloadSection = text.match(/## payload 字段([\s\S]*?)(?=\n## |$)/u)?.[1] ?? '';
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(payloadSection).toMatch(new RegExp('`' + field + '`[^\\n]*(必填|required)', 'iu'));
    }
    expect(payloadSection).toMatch(/`base_sha`[^\n]*(可选|可省略)/u);
    expect(payloadSection).toMatch(/生产 Brain[^\n]*自解析/u);
  });

  it('派发失败回滚精确覆盖 run session task 三个终态', () => {
    const text = guide();
    const rollbackSection = text.match(/## 派发失败自动回滚([\s\S]*?)(?=\n## |$)/u)?.[1] ?? '';
    expect(rollbackSection).toContain('run→failed');
    expect(rollbackSection).toContain('session→closed');
    expect(rollbackSection).toContain('task→cancelled');
  });

  it('正文主体为中文且只展示凭据变量名不含真实凭据', () => {
    const text = guide();
    const prose = text
      .replace(/```[\s\S]*?```/gu, '')
      .replace(/`[^`]+`/gu, '')
      .replace(/https?:\/\/\S+/gu, '');
    const chineseCount = (prose.match(/[\u4e00-\u9fff]/gu) ?? []).length;
    const latinWordCount = (prose.match(/\b[A-Za-z]{4,}\b/gu) ?? []).length;
    expect(chineseCount).toBeGreaterThan(latinWordCount * 2);

    expect(text).not.toMatch(/Authorization:\s*Bearer\s+(?!CECELIA_INTERNAL_TOKEN\b)[A-Za-z0-9._~+\/-]{8,}/u);
    expect(text).not.toMatch(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u);
    expect(text).not.toMatch(/CECELIA_INTERNAL_TOKEN\s*=\s*["']?(?!<|\$|\{)[A-Za-z0-9._~+\/-]{8,}/u);
  });
});
