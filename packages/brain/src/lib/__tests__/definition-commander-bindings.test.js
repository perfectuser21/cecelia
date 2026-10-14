import { describe, it, expect } from 'vitest';
import { stepSha256 } from '../../../scripts/sync-steps-from-workspace.mjs';
import { commanderBusinessContract, freezeCommanderDeclarations } from '../definition-commander-bindings.js';

const business = { key: 'report', acceptance: ['实际JSON与CSV一致'], by: 'code' };
const identity = kind => ({ kind, id: `${kind}-report`, version: '2', digest: (kind === 'skill' ? 'a' : 'b').repeat(64) });
const selected = kind => ({ implementation: identity(kind), path: `report/${kind}.${kind === 'skill' ? 'md' : 'py'}` });
const sources = () => ['code', 'skill'].map(kind => ({ ...identity(kind), name: `${kind}-report`, scope: 'activity',
  path: selected(kind).path, repo: 'org/runtime', revision: 'c'.repeat(40), digest: `sha256:${identity(kind).digest}`,
  status: 'verified', validation_scope: 'reference_only' }));
const primary = kind => ({ ...selected(kind), business_requirement_sha256: stepSha256(business) });
const pair = () => ({ business_requirement_sha256: stepSha256(business), code: selected('code'), skill: { ...selected('skill'),
  verification_ref: { task_id: '44444444-4444-4444-8444-444444444444', run_id: 'wfd-44444444-1', definition_sha256: 'd'.repeat(64) } } });

describe('冻结Commander来源声明边界', () => {
  it('业务摘要不依赖声明自身，其他业务要求完整保留', () => {
    expect(commanderBusinessContract({ ...business, commander_implementation: primary('skill'), commander_implementations: pair() })).toEqual(business);
  });
  it('已验证Skill可独立先用，冻结对象不跟随源对象改变', () => {
    const declaration = primary('skill');
    const frozen = freezeCommanderDeclarations({ ...business, commander_implementation: declaration }, sources());
    declaration.implementation.version = 'changed';
    expect(frozen.commander_implementation).toEqual(primary('skill'));
  });
  it('配套声明保存正式核验引用，支持标准sha256来源摘要', () => {
    const frozen = freezeCommanderDeclarations({ ...business, commander_implementations: pair() }, sources());
    expect(frozen.commander_implementations).toEqual(pair());
  });
  it.each(['unverified', 'wrong-version', 'wrong-name', 'non-reference-scope'])('来源%s不能成为独立Skill身份', reason => {
    const bindings = sources(), skill = bindings[1];
    if (reason === 'unverified') skill.status = 'pending';
    if (reason === 'wrong-version') skill.version = '1';
    if (reason === 'wrong-name') skill.name = 'other-skill';
    if (reason === 'non-reference-scope') skill.validation_scope = 'executable';
    expect(() => freezeCommanderDeclarations({ ...business, commander_implementation: primary('skill') }, bindings)).toThrow('来源');
  });
  it('同名路径的多个不同Git来源不允许猜选', () => {
    const bindings = sources();
    bindings.push({ ...bindings[1], repo: 'other/runtime' });
    expect(() => freezeCommanderDeclarations({ ...business, commander_implementation: primary('skill') }, bindings)).toThrow('来源');
  });
  it.each(['../report.py', 'report\\code.py', 'report\u0000.py', 'report.py?other'])('拒绝越界或含控制字符路径%j', path => {
    const declaration = { ...primary('code'), path };
    expect(() => freezeCommanderDeclarations({ ...business, commander_implementation: declaration }, sources())).toThrow('路径');
  });
  it('需求摘要漂移拒绝冻结', () => {
    expect(() => freezeCommanderDeclarations({ ...business, acceptance: ['另一业务要求'], commander_implementation: primary('skill') }, sources())).toThrow('业务合同摘要');
  });
  it('配套Code主实现不能替换成Skill独立主实现', () => {
    expect(() => freezeCommanderDeclarations({ ...business, commander_implementation: primary('skill'), commander_implementations: pair() }, sources())).toThrow('primary');
  });
});
