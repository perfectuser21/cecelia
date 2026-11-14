/** 当前编码类型与CI固定历史checkout能力的实际保护。 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CODING_MUTATION_TASK_TYPES } from '../lib/task-type-registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRAIN_DIR = join(HERE, '..', '..'); // packages/brain

describe('当前编码注册表语义', () => {
  it('coding_workflow 必须保留编码变更语义', () => {
    expect(CODING_MUTATION_TASK_TYPES).toContain('coding_workflow');
  });
});

// 用真实本地Git历史验证actions/checkout的实际depth参数。
it('基础CI检查的checkout必须能读取固定历史基线',()=>{
 const workflow=yaml.load(readFileSync(join(BRAIN_DIR,'../../.github/workflows/ci.yml'),'utf8'));
 const checkout=workflow.jobs.checks.steps.find(s=>s.uses?.startsWith('actions/checkout@'));
 const depth=checkout.with?.['fetch-depth']??1;
 const root=mkdtempSync(join(tmpdir(),'dod-baseline-')),origin=join(root,'origin'),clone=join(root,'checkout');
 const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  git(root,'init','-q',origin);git(origin,'config','user.name','fixture');git(origin,'config','user.email','fixture@example.invalid');
  writeFileSync(join(origin,'baseline.txt'),'fixed baseline');git(origin,'add','.');git(origin,'commit','-qm','baseline');const base=git(origin,'rev-parse','HEAD');
  writeFileSync(join(origin,'baseline.txt'),'current bytes');git(origin,'commit','-qam','head');
  git(root,'clone','-q',...(Number(depth)===0?[]:['--depth',String(depth)]),`file://${origin}`,clone);
  let baseline;try{baseline=git(clone,'show',`${base}:baseline.txt`);}catch{baseline='BASELINE_OBJECT_MISSING';}
  expect(baseline).toBe('fixed baseline');
 }finally{rmSync(root,{recursive:true,force:true});}
});
