import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { managedSpecFixture, hash } from './helpers/managed-spec.mjs';
import { git } from './helpers/git.mjs';

describe('从受保护01读取固定原文', () => {
  it('原文来自固定Git，不读取候选同路径；规则ID与I-n分开', async () => {
    const { loadBaselineContext } = await import('../lib/baseline-context.mjs');
    const f = managedSpecFixture();
    try {
      fs.writeFileSync(path.join(f.root, 'rule.md'), '候选覆盖不得冒充原文');
      const b = loadBaselineContext(f.input);
      expect(b.status).toBe('managed'); expect(b.base_sha).toBe(f.input.initial_base_sha);
      expect(b.rules).toEqual([{ ref_id: 'rule', rule_id: 'cw-safe', text: '不得丢弃已核实数据。' }]);
      expect(b.refs.find(r => r.ref_id === 'rule').content).toContain('不得丢弃已核实数据');
      expect(b.approvals).toEqual([]);
    } finally { f.clean(); }
  });
  it('重试不跟随新HEAD；原件digest/01被改、缺规则锚点均拒绝', async () => {
    const { loadBaselineContext } = await import('../lib/baseline-context.mjs');
    const f = managedSpecFixture();
    try {
      fs.writeFileSync(path.join(f.root, 'rule.md'), '<!-- rule: cw-next -->\n新规则\n');
      git(f.root, 'add', 'rule.md'); git(f.root, 'commit', '-qm', 'test: next');
      git(f.root, 'update-ref', 'refs/remotes/origin/main', git(f.root, 'rev-parse', 'HEAD').trim());
      expect(loadBaselineContext(f.input).rules[0].rule_id).toBe('cw-safe');
      const bad = structuredClone(f.input); bad.authority.refs[0].digest = 'f'.repeat(64);
      expect(() => loadBaselineContext(bad)).toThrow(/baseline_|authority_/);
      fs.appendFileSync(path.join(f.sprint, '01-intent.md'), '篡改');
      expect(() => loadBaselineContext(f.input)).toThrow(/baseline_intent_hash_mismatch/);
    } finally { f.clean(); }
    const noRules = managedSpecFixture({ rule: '未登记稳定锚点的规则' });
    try { expect(() => loadBaselineContext(noRules.input)).toThrow(/baseline_rules_unconfigured/); } finally { noRules.clean(); }
  });
  it('批准只来自真实I段，背景及模型生成理由不能授权；旧任务显式unconfigured', async () => {
    const { loadBaselineContext } = await import('../lib/baseline-context.mjs');
    expect(loadBaselineContext({})).toEqual({ status: 'unconfigured', refs: [], rules: [], approvals: [] });
    const f = managedSpecFixture({ items: ['批准修改 rule#cw-safe；继续保留其余业务约束。批准更新 sample。'] });
    try {
      const b = loadBaselineContext(f.input);
      expect(b.approvals).toEqual(expect.arrayContaining([{ ref_id: 'rule', rule_id: 'cw-safe', action: 'modify', intent_id: 'I-1' }, { ref_id: 'sample', action: 'update', intent_id: 'I-1' }]));
      const no = f.intent.replace('批准修改 rule#cw-safe', '讨论修改 rule#cw-safe').replace('批准更新 sample', '讨论更新 sample');
      fs.writeFileSync(path.join(f.sprint, '01-intent.md'), no);
      expect(loadBaselineContext({ ...f.input, intent_sha256: hash(no) }).approvals).toEqual([]);
    } finally { f.clean(); }
  });
});

it('legacy背景示例ref_id不误判；受管01丢input标记仍失败', async () => {
  const {loadBaselineContext}=await import('../lib/baseline-context.mjs');
  const f=managedSpecFixture();
  try {
    const input={...f.input};delete input.authority;delete input.authority_required;
    expect(()=>loadBaselineContext(input)).toThrow('baseline_binding_missing');
    fs.writeFileSync(path.join(f.sprint,'01-intent.md'),`---\ntask_id: ${input.task_id}\nstep: intent\nupstream: []\n---\n## 背景\n示例\n  ref_id: example\n### I-1\n保持行为\n`);
    expect(loadBaselineContext(input).status).toBe('unconfigured');
  }finally{f.clean();}
});
