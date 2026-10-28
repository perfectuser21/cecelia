import { describe, it, expect } from 'vitest';
import { specErrors } from '../lib/spec-check.mjs';
import { managedSpecFixture, specText, TASK } from './helpers/managed-spec.mjs';
import { parseMaterialPlan } from '../lib/spec-materials.mjs';

const baseline = { status: 'managed', object_id: 'coding-workflow', refs: ['spec', 'rule', 'sample', 'implementation'].map(kind => ({ ref_id: kind, kind, path: kind + '.md' })), rules: [{ ref_id: 'rule', rule_id: 'cw-safe', text: '不得丢数据' }], approvals: [] };
const check = (plan, context = baseline) => specErrors(specText(plan), TASK, ['I-1'], { baseline: context });
describe('旧规则与材料计划确定性检查', () => {
  it('已有合法规格对受管对象仍须逐项交代旧规则和材料', () => {
    expect(check(null)).toContain('material_plan_missing');
    expect(specErrors(specText(null), TASK, ['I-1'])).toEqual([]);
  });
  it.each([
    ['遗漏旧规则', p => { p.rules = []; }, 'rule_missing:rule#cw-safe'],
    ['伪造规则', p => { p.rules[0].rule_id = 'made-up'; }, 'rule_unknown:rule#made-up'],
    ['不存在的S', p => { p.rules[0].spec_ids = ['S-99']; }, 'spec_unknown:S-99'],
    ['不存在的Q', p => { p.materials[0].qa_ids = ['Q-99']; }, 'qa_unknown:Q-99'],
    ['无依据修改', p => { p.rules[0].action = 'modify'; p.rules[0].approval_refs = ['I-1']; }, 'approval_missing:rule#cw-safe'],
    ['冲突不能自动放宽', p => { p.rules[0].action = 'conflict'; }, 'rule_conflict:rule#cw-safe'],
    ['遗漏材料', p => { p.materials.pop(); }, 'material_missing:implementation'],
    ['材料换路径', p => { p.materials[0].path = 'other.md'; }, 'material_path_mismatch:spec'],
    ['样本预期变更', p => { p.materials[2].action = 'update'; }, 'approval_missing:sample'],
    ['无验证方式', p => { p.materials[0].verification = ''; }, 'material_verification_missing:spec'],
    ['额外路径越界', p => { p.materials[3].additional_changes = [{ path: '../bad', action: 'update', reason: '实现', verification: '测试' }]; }, 'material_extra_path_invalid:implementation'],
  ])('%s明确报错', (_name, mutate, expected) => {
    const f = managedSpecFixture();
    try { mutate(f.plan); expect(check(f.plan).some(e => e.includes(expected))).toBe(true); } finally { f.clean(); }
  });
  it('保留及明确批准的修改通过，不能用另一个规则的批准', () => {
    const f = managedSpecFixture();
    try {
      expect(check(f.plan)).toEqual([]);
      f.plan.rules[0].action = 'modify'; f.plan.rules[0].approval_refs = ['I-1'];
      const approved = { ...baseline, approvals: [{ ref_id: 'rule', rule_id: 'cw-safe', action: 'modify', intent_id: 'I-1' }] };
      expect(check(f.plan, approved)).toEqual([]);
      expect(check(f.plan, { ...approved, approvals: [{ ...approved.approvals[0], rule_id: 'cw-other' }] })).toContain('approval_missing:rule#cw-safe');
    } finally { f.clean(); }
  });
});

it('单条规则批准不能授权废弃整个规则文件或额外文件', () => {
  const f = managedSpecFixture();
  try {
    const row = f.plan.materials.find(r=>r.ref_id==='rule');
    row.rule_id='cw-safe'; row.action='retire'; row.approval_refs=['I-1'];
    const approved={...baseline,approvals:[{ref_id:'rule',rule_id:'cw-safe',action:'retire',intent_id:'I-1'}]};
    expect(check(f.plan,approved)).toContain('approval_missing:rule');
    row.action='keep';row.additional_changes=[{path:'extra.md',action:'retire',reason:'清理',verification:'核验'}];
    expect(check(f.plan,approved)).toContain('approval_missing:rule');
  } finally {f.clean();}
});

it('空冻结规则集、超长和异常嵌套计划不能当作有效覆盖', () => {
  const f = managedSpecFixture();
  try {
    expect(check({ ...f.plan, rules: [] }, { ...baseline, rules: [] })).toContain('baseline_rules_unconfigured');
    expect(() => parseMaterialPlan(specText({ ...f.plan, padding: 'x'.repeat(300000) }))).toThrow('material_plan_too_large');
    let nested = {}; for (let i = 0; i < 20; i++) nested = { child: nested };
    expect(() => parseMaterialPlan(specText({ ...f.plan, nested }))).toThrow('material_plan_too_deep');
  } finally { f.clean(); }
});

it('材料更新表仅允许保留或更新', () => {
  const f = managedSpecFixture();
  try {
    f.plan.materials[0].action = 'retire';
    expect(check(f.plan)).toContain('material_action_invalid:spec');
  } finally { f.clean(); }
});
