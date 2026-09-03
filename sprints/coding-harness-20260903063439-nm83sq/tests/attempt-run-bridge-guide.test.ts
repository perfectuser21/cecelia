import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DOC = 'docs/current/attempt-run-bridge-guide.md';
const HASH = '64de302ba99ea7e35a528afdc12dbeaa8eede8d1076c32f7fef385b0504b9709';
const ROLES = [
  'canary',
  'planner',
  'proposer',
  'reviewer',
  'generator',
  'generator-fix',
  'evaluator',
  'evaluator-evidence-repair',
  'judge',
] as const;

function documentText() {
  return readFileSync(DOC, 'utf8');
}

describe('attempt-run 桥接使用说明 task_request_hash=' + HASH, () => {
  it('文档写明两个端点用途，且不把 GET 写成创建或派发入口', () => {
    const text = documentText();
    expect(text).toMatch(/POST \/api\/brain\/harness\/attempt-run/);
    expect(text).toMatch(/GET \/api\/brain\/harness\/attempt-run\/:id/);
    expect(text).toMatch(/POST[^\n]*(创建|派发)/);
    expect(text).toMatch(/GET[^\n]*(查询|状态|结果)/);
    expect(text).not.toMatch(/GET[^\n]*(创建|发起派发)/);
  });

  it('鉴权正向说明 internalAuthOrLoopback 与远端 Bearer，且负向禁止真实令牌和远端免鉴权', () => {
    const text = documentText();
    expect(text).toContain('internalAuthOrLoopback');
    expect(text).toMatch(/宿主|远端/);
    expect(text).toContain('Authorization: Bearer <CECELIA_INTERNAL_TOKEN>');
    expect(text).not.toMatch(/CECELIA_INTERNAL_TOKEN\s*=\s*[A-Za-z0-9_-]{8,}/);
    expect(text).not.toMatch(/远端[^\n]*(无需|不需要)[^\n]*(Bearer|鉴权|令牌)/);
  });

  it('角色白名单是逐项列名的恰好九项封闭集合，且没有“等”字省略', () => {
    const text = documentText();
    const section = text.match(/## 角色白名单\n([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    const listed = [...section.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
    expect(listed).toEqual([...ROLES]);
    expect(new Set(listed).size).toBe(9);
    expect(section).not.toContain('等');
    expect(section).not.toMatch(/commander|publisher/);
  });

  it('payload 正向列出三个必填字段和可省略 base_sha，且负向不把 base_sha 写成必填或调用方猜测', () => {
    const text = documentText();
    const section = text.match(/## Payload 字段\n([\s\S]*?)(?=\n## )/)?.[1] ?? '';
    for (const field of ['sprint_dir', 'base_repo', 'branch']) {
      expect(section).toMatch(new RegExp('`' + field + '`[^\\n]*必填'));
    }
    expect(section).toMatch(/`base_sha`[^\n]*(可省略|选填)/);
    expect(section).toMatch(/生产 Brain[^\n]*(解析|解析出)/);
    expect(section).not.toMatch(/`base_sha`[^\n]*必填/);
    expect(section).not.toMatch(/调用方[^\n]*(猜测|自行推断)[^\n]*`base_sha`/);
  });

  it('派发失败正向列出三实体回滚终态，且负向不出现相反终态或缺项表达', () => {
    const text = documentText();
    const section = text.match(/## 派发失败自动回滚\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
    expect(section).toMatch(/run[^\n]*failed/);
    expect(section).toMatch(/session[^\n]*closed/);
    expect(section).toMatch(/task[^\n]*cancelled/);
    expect(section).not.toMatch(/run[^\n]*(completed|running)/);
    expect(section).not.toMatch(/session[^\n]*(active|open)/);
    expect(section).not.toMatch(/task[^\n]*(queued|completed)/);
  });
});
