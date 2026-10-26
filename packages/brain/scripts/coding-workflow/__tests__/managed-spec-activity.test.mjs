import { it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { runActivityProcess } from './helpers/run-activity.mjs';
import { managedSpecFixture } from './helpers/managed-spec.mjs';

it('真实spec活动不能接受遗漏全部旧规则的模型规格', async () => {
  const f = managedSpecFixture();
  try {
    const r = await runActivityProcess(fileURLToPath(new URL('../activities/spec.mjs', import.meta.url)), f.input, {
      CODING_WF_CLAUDE_BIN: fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url)), FAKE_CLAUDE_MODE: 'ok',
    });
    expect(r.result.reason_code, r.stderr).toBe('spec_invalid');
    expect(r.result.evidence[0].spec_errors).toContain('material_plan_missing');
  } finally { f.clean(); }
});

import fs from 'node:fs';
import path from 'node:path';
import { specText } from './helpers/managed-spec.mjs';
const entry = name => fileURLToPath(new URL(`../activities/${name}.mjs`, import.meta.url));
const gan = fileURLToPath(new URL('./fixtures/fake-claude-gan.mjs', import.meta.url));
async function review(f, script) {
  fs.writeFileSync(path.join(f.tmp, 'script.json'), JSON.stringify(script));
  return runActivityProcess(entry('spec-review'), f.input, {
    CODING_WF_CLAUDE_BIN: gan, FAKE_GAN_SCRIPT: path.join(f.tmp, 'script.json'),
    FAKE_GAN_STATE: path.join(f.tmp, 'state.json'), FAKE_GAN_PROMPTS: path.join(f.tmp, 'prompts.jsonl'),
  });
}
it('真实评审高分不能放过遗漏材料计划', async () => {
  const f = managedSpecFixture();
  try {
    fs.writeFileSync(path.join(f.sprint, '02-spec.md'), specText(null));
    const r = await review(f, { reviews: [{ scores: 9 }] });
    expect(r.result.reason_code, r.stderr).toBe('spec_invalid');
    expect(r.result.evidence[0].spec_errors).toContain('material_plan_missing');
  } finally { f.clean(); }
});
it('真实生成收到固定原文并交出合法材料计划', async () => {
  const f = managedSpecFixture();
  try {
    const fake = path.join(f.tmp, 'writer.mjs');
    fs.writeFileSync(fake, `#!/usr/bin/env node\nimport fs from 'node:fs';\nconst a=process.argv;const p=a[a.indexOf('-p')+1];fs.writeFileSync(${JSON.stringify(path.join(f.tmp,'prompt'))},p);fs.writeFileSync(${JSON.stringify(path.join(f.sprint,'02-spec.md'))},${JSON.stringify(specText(f.plan))});console.log('ok');`);
    fs.chmodSync(fake, 0o755);
    const r = await runActivityProcess(entry('spec'), f.input, { CODING_WF_CLAUDE_BIN: fake });
    expect(r.result.status, r.stderr).toBe('completed');
    const prompt = fs.readFileSync(path.join(f.tmp, 'prompt'), 'utf8');
    expect(prompt).toContain('不得丢弃已核实数据');
    expect(prompt).toContain(f.input.initial_base_sha);
  } finally { f.clean(); }
});
it('真实多轮review和revise拿同一固定原文；合法保留可通过', async () => {
  const f = managedSpecFixture();
  try {
    const spec = specText(f.plan);
    fs.writeFileSync(path.join(f.sprint, '02-spec.md'), spec);
    const r = await review(f, { reviews: [{ scores: 6, issues: [{id:'R-1',severity:'阻断'}] }, { scores: 8, prior:[{id:'R-1',status:'关闭'}] }], revise:{replaceSpec:spec} });
    expect(r.result.status, r.stderr).toBe('completed');
    const prompts = fs.readFileSync(path.join(f.tmp,'prompts.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    expect(prompts.map(p=>p.role)).toEqual(['spec_review','spec_revise','spec_review']);
    for (const {prompt} of prompts) {
      expect(prompt).toContain('不得丢弃已核实数据');
      expect(prompt).toContain(f.input.initial_base_sha);
    }
  } finally { f.clean(); }
});
it('真实改写删除计划会在第二轮评审前失败', async () => {
  const f = managedSpecFixture();
  try {
    fs.writeFileSync(path.join(f.sprint, '02-spec.md'), specText(f.plan));
    const r = await review(f, { reviews:[{scores:6,issues:[{id:'R-1',severity:'阻断'}]}], revise:{replaceSpec:specText(null)} });
    expect(r.result.reason_code, r.stderr).toBe('spec_invalid');
    expect(r.result.evidence[0].spec_errors).toContain('material_plan_missing');
    expect(JSON.parse(fs.readFileSync(path.join(f.tmp,'state.json'),'utf8'))).toEqual({review:1,revise:1});
  } finally { f.clean(); }
});
it('固定引用失真在调用模型前分类失败', async () => {
  const f = managedSpecFixture();
  try {
    f.input.authority.refs[0].digest = '0'.repeat(64);
    const r = await runActivityProcess(entry('spec'), f.input, { CODING_WF_CLAUDE_BIN: '/not-called' });
    expect(r.result.reason_code, r.stderr).toBe('baseline_invalid');
  } finally { f.clean(); }
});
it('真实冻结I条目的批准修改可通过，审批依据保留在三阶段上下文', async () => {
  const f = managedSpecFixture({items:['批准修改 rule#cw-safe；批准更新 sample。']});
  try {
    f.plan.rules[0].action='modify'; f.plan.rules[0].approval_refs=['I-1'];
    f.plan.materials.find(r=>r.ref_id==='sample').action='update';
    f.plan.materials.find(r=>r.ref_id==='sample').approval_refs=['I-1'];
    fs.writeFileSync(path.join(f.sprint,'02-spec.md'),specText(f.plan));
    const r=await review(f,{reviews:[{scores:8}]});
    expect(r.result.status,r.stderr).toBe('completed');
    const prompt=JSON.parse(fs.readFileSync(path.join(f.tmp,'prompts.jsonl'),'utf8').trim()).prompt;
    expect(prompt).toContain('"action": "modify"');expect(prompt).toContain('"intent_id": "I-1"');
  }finally{f.clean();}
});
