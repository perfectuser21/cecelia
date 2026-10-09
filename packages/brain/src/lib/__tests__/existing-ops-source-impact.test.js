import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';
import {buildExistingOpsSources} from '../existing-ops-source.js';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const paths=execFileSync('git',['ls-tree','-rz','--name-only',revision],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const cache=new Map();
const read=path=>{if(!cache.has(path))cache.set(path,execFileSync('git',['show',`${revision}:${path}`],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}));return cache.get(path);};
const workflow='.github/workflows/implementation-impact.yml';
const entry='scripts/ci/implementation-multi-pr-gate.mjs',multi='scripts/ci/implementation-multi-scope.mjs';
const build=async overrides=>(await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision,paths,readSource:async path=>overrides?.[path]??read(path)})).consumers[1];
it('F3只以固定PR条件runner和实际AST调用链认领多scope脚本，完整工厂仍不可执行',async()=>{
 const f3=await build();expect(f3.status,JSON.stringify(f3.gaps)).toBe('verified');
 for(const path of [workflow,entry,multi,'scripts/ci/implementation-pr-gate.mjs','scripts/ci/implementation-gate.mjs'])expect(f3.bindings.some(b=>b.path===path),path).toBe(true);
 expect(f3.input_relations).toContainEqual(expect.objectContaining({consumer_path:workflow,input_path:entry,kind:'conditional_pr_admission_runner'}));
 expect(f3.input_relations).toContainEqual(expect.objectContaining({consumer_path:entry,input_path:multi,kind:'reachable_named_import_call'}));
});
it.each(['comment','dead_branch','wrong_env','wrong_schema'])('PR runner %s变化不得用旧字符串伪认领',async kind=>{
 const doc=yaml.load(read(workflow)),job=doc.jobs.gate;
 const step=job.steps.find(s=>typeof s.run==='string'&&s.run.includes('implementation-multi-pr-gate.mjs'));
 if(kind==='comment')step.run=step.run.split('\n').map(l=>'# '+l).join('\n');
 if(kind==='dead_branch')step.run=step.run.replace('[[ "$MODE" == pr && -n "$ADMISSION_SCOPES" ]]','false');
 if(kind==='wrong_env')job.env.MODE='main';
 if(kind==='wrong_schema')doc.on.workflow_call.inputs.admission_scopes.required=true;
 const result=await build({[workflow]:yaml.dump(doc)});expect(result.status).toBe('unknown');expect(result.bindings).toEqual([]);
});
it.each(['comment','dead_function','dead_if','removed_import'])('多scope实际调用链 %s缺失则F3 UNKNOWN',async kind=>{
 let text=read(entry);
 if(kind==='comment')text='/*'+text+'*/';
 if(kind==='dead_function')text=text.replace('const receipt=await runScopedImplementationGate','function unused(){const receipt=runScopedImplementationGate').replace('receipt.resolution_sha256=resolution.resolution_sha256;','} const receipt={};');
 if(kind==='dead_if')text=text.replace('const receipt=await runScopedImplementationGate({repoRoot,evidence:resolution.evidence});','if(false){await runScopedImplementationGate({repoRoot,evidence:resolution.evidence});} const receipt={};');
 if(kind==='removed_import')text=text.replace("from './implementation-multi-scope.mjs'","from './unrelated.mjs'");
 const result=await build({[entry]:text});expect(result.status).toBe('unknown');expect(result.bindings).toEqual([]);
});
