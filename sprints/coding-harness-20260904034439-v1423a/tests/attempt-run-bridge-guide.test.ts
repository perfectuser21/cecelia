import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BASE_SHA = 'bdaca81b5cbf78929fa3d8eeac2a24cae6113b98';
const GUIDE = 'docs/current/attempt-run-bridge-guide.md';
const ROLES = [
  'planner', 'proposer', 'proposer-critic', 'generator', 'generator-critic',
  'evaluator', 'evaluator-critic', 'reporter', 'reporter-critic',
] as const;

function readGuide() {
  return readFileSync(GUIDE, 'utf8');
}

function hasEndpointContract(text: string) {
  return text.includes('## 端点与鉴权')
    && text.includes('POST /api/brain/harness/attempt-run')
    && text.includes('GET /api/brain/harness/attempt-run/:id')
    && /POST[^\n]*(创建|派发)/.test(text)
    && /GET[^\n]*(查询|轮询)/.test(text);
}

function hasAuthContract(text: string) {
  return text.includes('## 端点与鉴权')
    && text.includes('internalAuthOrLoopback')
    && text.includes('Bearer CECELIA_INTERNAL_TOKEN')
    && /(宿主|远端)[^\n]*必须[^\n]*Bearer CECELIA_INTERNAL_TOKEN/.test(text)
    && /(loopback|本机回环)[^\n]*(免|无需)[^\n]*(Bearer|令牌|鉴权)/i.test(text);
}

function extractRoleList(text: string) {
  const section = text.match(/## 角色白名单\s*\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
  return [...section.matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)].map((match) => match[1]);
}

function hasExactRoles(text: string) {
  const actual = extractRoleList(text);
  return actual.length === 9
    && new Set(actual).size === 9
    && actual.every((role) => ROLES.includes(role as typeof ROLES[number]))
    && ROLES.every((role) => actual.includes(role));
}

function hasPayloadContract(text: string) {
  return text.includes('## payload 与 base_sha')
    && ['sprint_dir', 'base_repo', 'branch'].every((field) => text.includes(`\`${field}\``))
    && /base_sha[^\n]*(可省略|非必填)/.test(text)
    && /生产 Brain[^\n]*自解析/.test(text)
    && /实现基线[^\n]*(保持不变|不得改变)/.test(text)
    && /workspace[^\n]*base_sha[^\n]*(不得替代|不能替代)/.test(text);
}

function hasRollbackContract(text: string) {
  return text.includes('## 派发失败自动回滚')
    && text.includes('run→failed')
    && text.includes('session→closed')
    && text.includes('task→cancelled')
    && /派发失败[^\n]*自动回滚/.test(text);
}

describe('attempt-run 桥接使用说明合同', () => {
  it('文档中文标题与两个端点用途完整，缺任一正向信息或混淆用途会被拒绝', () => {
    const text = readGuide();
    expect(text).toContain('# attempt-run 桥接使用说明');
    expect(hasEndpointContract(text)).toBe(true);
    expect(hasEndpointContract(text.replace('POST /api/brain/harness/attempt-run', 'POST /wrong'))).toBe(false);
    expect(hasEndpointContract(text.replace(/POST[^\n]*(创建|派发)[^\n]*/, 'POST 用于查询'))).toBe(false);
  });

  it('鉴权说明区分 loopback 与宿主远端，遗漏 Bearer 或误写远端免鉴权会被拒绝', () => {
    const text = readGuide();
    expect(hasAuthContract(text)).toBe(true);
    expect(hasAuthContract(text.replace('Bearer CECELIA_INTERNAL_TOKEN', 'Bearer OTHER_TOKEN'))).toBe(false);
    expect(hasAuthContract(text.replace(/(宿主|远端)[^\n]*必须[^\n]*Bearer CECELIA_INTERNAL_TOKEN/, '宿主或远端无需令牌'))).toBe(false);
  });

  it('角色白名单从文档提取后恰好九项封闭集合，缺项重复或额外角色会被拒绝', () => {
    const text = readGuide();
    expect(extractRoleList(text)).toHaveLength(9);
    expect(hasExactRoles(text)).toBe(true);
    expect(hasExactRoles(text.replace('- `planner`', ''))).toBe(false);
    expect(hasExactRoles(text.replace('- `planner`', '- `planner`\n- `reviewer`'))).toBe(false);
    expect(hasExactRoles(`${text.replace(/## payload/, '- `intruder`\n\n## payload')}`)).toBe(false);
  });

  it('payload 三个必填字段与 base_sha 生产解析及冻结基线规则完整，反向写法会被拒绝', () => {
    const text = readGuide();
    expect(hasPayloadContract(text)).toBe(true);
    expect(hasPayloadContract(text.replace('`sprint_dir`', '`wrong_dir`'))).toBe(false);
    expect(hasPayloadContract(text.replace(/base_sha[^\n]*(可省略|非必填)[^\n]*/, '`base_sha` 必填'))).toBe(false);
    expect(hasPayloadContract(text.replace(/workspace[^\n]*base_sha[^\n]*(不得替代|不能替代)[^\n]*/, 'workspace base_sha 可以替代实现基线'))).toBe(false);
  });

  it('派发失败自动回滚三个终态完整，遗漏或部分成功表述会被拒绝', () => {
    const text = readGuide();
    expect(hasRollbackContract(text)).toBe(true);
    expect(hasRollbackContract(text.replace('session→closed', 'session→active'))).toBe(false);
    expect(hasRollbackContract(text.replace(/派发失败[^\n]*自动回滚/, '派发失败后部分成功'))).toBe(false);
  });

  it('交付范围相对冻结基线排除 sprints 后恰好只有 docs current 一页说明且无代码', () => {
    const changed = execFileSync('git', ['diff', '--name-only', `${BASE_SHA}...HEAD`], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean).filter((path) => !path.startsWith('sprints/'));
    expect(changed).toEqual([GUIDE]);
    expect(changed.some((path) => /\.(?:js|cjs|mjs|ts|tsx|jsx|py|sql)$/.test(path))).toBe(false);
    expect([...changed, 'packages/brain/src/server.js']).not.toEqual([GUIDE]);
  });
});
