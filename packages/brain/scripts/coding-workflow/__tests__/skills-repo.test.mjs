import {it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadRepos,resolveRepo,enabledRepos,resolveEntry,repoView,stateDir} from '../runner/lib/repos.mjs';
import {pickCandidates} from '../runner/lib/plan.mjs';
import {checksFor,runPrechecks} from '../lib/ci-precheck.mjs';
import {repoRules,PRECHECK_SETS} from '../lib/repo-profile.mjs';
import {loadRepositoryFacts,resolveCanonicalRoutingEvidence} from '../../../src/work-routing-store.js';
import {routeWork} from '../../../src/work-router.js';
const aliases=['zenithjoy-skills','perfectuser21/zenithjoy-skills','https://github.com/perfectuser21/zenithjoy-skills.git'];
it('Skills aliases route and become runner candidates with independent clone/worktree/state',async()=>{
 const repos=loadRepos(),skills=repos.find(r=>r.key==='zenithjoy-skills');expect(skills).toBeTruthy();
 const facts=await loadRepositoryFacts({query:async()=>({rows:[{scope_key:'zenithjoy-skills',repo:'zenithjoy-skills',adapter_config:{source_repo:'perfectuser21/zenithjoy-skills'}}]})});
 for(const alias of aliases){
  expect(resolveRepo(alias,repos)).toBe(skills.key);
  const route=routeWork({source:'api',source_id:'skills-fixture',title:'修复Skill',mutation_intent:'write',declared_change_kind:'bugfix',repo_hint:alias,map_scope_hint:['skill_distribution'],branch:'cp-skills-fixture',base_sha:'a'.repeat(40)},facts);
  expect(route.canonical_task_type).toBe('coding_workflow');expect(route.repo).toBe(skills.key);
  const task={id:'skills-fixture',task_type:route.canonical_task_type,payload:{repo:alias},created_at:'2026-10-18T00:00:00Z'};
  expect(pickCandidates([task])[0]?.repoKey).toBe(skills.key);
  expect(pickCandidates([task],{enabled:['cecelia']})).toEqual([]);
 }
 expect(enabledRepos({CODING_WF_REPOS:skills.key},repos.map(r=>r.key===skills.key?{...r,enabled:false}:r))).toEqual([]);
 const view=repoView({trustedRepo:'/trusted',logDir:'/logs'},resolveEntry(skills,{HOME:'/fixture'}));
 expect(view.repo).toBe('/fixture/perfect21/zenithjoy-skills-cw-runner');expect(view.worktreeBase).toBe('/fixture/worktrees/zenithjoy-skills-cw');expect(stateDir(view)).toBe('/logs/zenithjoy-skills');
 expect(skills.required_checks).toEqual(['lint-skills']);expect(skills.install).toEqual(['python3','--version']);
 expect(PRECHECK_SETS).toContain(skills.prechecks);expect(repoRules(skills)).toContain('lint-skills');
});
it('Skills prechecks invoke actual Python/bash, fail on bad input and never skip missing required scripts',async()=>{
 const skills=loadRepos().find(r=>r.key==='zenithjoy-skills');expect(skills).toBeTruthy();
 const checks=checksFor(skills,{});expect(checks.every(c=>['python3','bash'].includes(c.cmd?.[0]))).toBe(true);
 expect(checks.some(c=>c.cmd?.some(x=>x.endsWith('/lint-skills.py')))).toBe(true);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'skills-precheck-'));
 try{
  const check=checks.find(c=>c.cmd?.some(x=>x.endsWith('/lint-skills.py')));
  const relative=check.cmd.find(x=>x.endsWith('.py'));fs.mkdirSync(path.dirname(path.join(root,relative)),{recursive:true});
  fs.writeFileSync(path.join(root,relative),'from pathlib import Path\nassert "description:" in Path("SKILL.md").read_text(), "missing description"\n');
  fs.writeFileSync(path.join(root,'SKILL.md'),'---\nname: bad\n---\n');
  let [result]=await runPrechecks(root,{checks:[check]});expect(result.ok).toBe(false);expect(result.output_tail).toContain('missing description');
  fs.writeFileSync(path.join(root,'SKILL.md'),'---\nname: good\ndescription: fixture\n---\n');
  [result]=await runPrechecks(root,{checks:[check]});expect(result.ok).toBe(true);
  fs.unlinkSync(path.join(root,relative));[result]=await runPrechecks(root,{checks:[check]});expect(result.ok).toBe(false);expect(result.skipped).not.toBe(true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
it('Skills routing base is read from its own clone instead of the current Cecelia cwd',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'skills-route-root-')),old=process.env.REPO_ROOT_ZENITHJOY_SKILLS;
 try{
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();git('init','-q','-b','cp-fixture');git('config','core.hooksPath','/dev/null');fs.writeFileSync(path.join(root,'SKILL.md'),'fixture');git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');const sha=git('rev-parse','HEAD');git('update-ref','refs/remotes/origin/main',sha);
  process.env.REPO_ROOT_ZENITHJOY_SKILLS=root;
  const actual=await resolveCanonicalRoutingEvidence({repo:'zenithjoy-skills',branch:'cp-skills-fixture',source:'api',source_id:'fixture'},[{repo:'zenithjoy-skills'}]);expect(actual.base_sha).toBe(sha);
 }finally{if(old===undefined)delete process.env.REPO_ROOT_ZENITHJOY_SKILLS;else process.env.REPO_ROOT_ZENITHJOY_SKILLS=old;fs.rmSync(root,{recursive:true,force:true});}
});
