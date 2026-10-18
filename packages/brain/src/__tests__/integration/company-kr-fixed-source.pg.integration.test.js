/** Official company-KR scratch adapter must persist both source identities, not merely lint them. */
import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {versionsDatabase} from '../fixtures/definition-versions-db.js';
import {minimumMapSchema} from '../fixtures/minimum-map-schema.js';
import {registerCompanyKrWorkflow} from '../../lib/company-kr-registration.js';
import {exportImplementationSnapshot} from '../../lib/implementation-ci-snapshot.js';
import {buildPrImplementationSnapshot} from '../../../../../scripts/ci/implementation-snapshot.mjs';
it('真实KR官方登记→候选重建→PG快照保留声明与中央固定来源',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kr-central-source-'));let f;
 try{
  const git=(cwd,...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-C',cwd,...args],{encoding:'utf8'}).trim();
  const put=(cwd,path,text)=>{mkdirSync(dirname(join(cwd,path)),{recursive:true});writeFileSync(join(cwd,path),text);};
  const commit=cwd=>{git(cwd,'add','-A');git(cwd,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixed');return git(cwd,'rev-parse','HEAD');};
  const central=join(root,'.skills-source');git(root,'init','-q');mkdirSync(central);git(central,'init','-q');
  const skillPath='.claude/skills/analyst/SKILL.md',sourcePath='business-skills/cecelia/analyst/SKILL.md',content='---\nname: analyst\nversion: 1\n---\nfixed analyst\n';
  put(central,sourcePath,content);put(central,'distribution/catalog.json',JSON.stringify({version:1,profiles:{cecelia:{files:[{path:skillPath,source:sourcePath,sha256:createHash('sha256').update(content).digest('hex')}]}}}));const cr=commit(central);
  put(root,'.gitignore','.skills-source/\n');put(root,'.skills-source.json',JSON.stringify({version:1,repository:'perfectuser21/zenithjoy-skills',revision:cr,profile:'cecelia',loader_sha256:'a'.repeat(64)}));
  const spec={key:'company_kr_analysis',name:'公司KR',version:'1.0.0',capability:'company_kr_analysis',capability_id:randomUUID(),capability_code:'G5',capability_name:'管家 · G5 战略 OKR',area_id:randomUUID(),agent:'analyst',runtime:'kr',activities:[{key:'analyze',name:'分析',executor:'agent',location:'mmv',implementation:'analyst',implementation_bindings:[{kind:'skill',repo:'perfectuser21/cecelia',revision:'contract',path:skillPath}]}],steps:[{key:'analyze.read',activity:'analyze',readback:{name:'核对',asserts:['真实原件'],implementation:'analyst'}}]};
  put(root,'packages/brain/config/company-kr-workflow.json',JSON.stringify(spec));const base=commit(root);put(root,'candidate.txt','new fixed candidate');const head=commit(root);
  f=await versionsDatabase();await f.migrate();await minimumMapSchema(f.client);
  await f.db.query('INSERT INTO capabilities(id,name,parent_journey_id,capability_code) VALUES($1,$2,$3,$4)',[spec.capability_id,spec.capability_name,randomUUID(),'G5']);
  await registerCompanyKrWorkflow(f.db,{spec,revision:base,readSource:async()=>JSON.stringify(spec),readBinding:async()=>content,definitionsOnly:true});
  const registry=await exportImplementationSnapshot(f.db,{scope:'cecelia-kr',repo:'perfectuser21/cecelia',revision:base});
  const candidate=await buildPrImplementationSnapshot(f.db,registry,head,root);
  const binding=candidate.definitions.activities.flatMap(a=>a.payload.implementation_bindings).find(b=>b.kind==='skill');
  expect(binding).toMatchObject({repo:'perfectuser21/cecelia',revision:head,path:skillPath,status:'verified',resolved_source:{repo:'perfectuser21/zenithjoy-skills',revision:cr,path:sourcePath}});
  const rows=(await f.db.query('SELECT payload FROM activity_definition_versions WHERE source_commit=$1',[head])).rows;
  expect(rows[0].payload.implementation_bindings[0].resolved_source).toEqual(binding.resolved_source);
 }finally{await f?.close();rmSync(root,{recursive:true,force:true});}
});
