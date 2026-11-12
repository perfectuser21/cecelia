import {it,expect} from 'vitest';
import {parse} from 'acorn';
import {collectBasicCiSources,collectDeepCiSources} from '../existing-ops-stage-source.js';
import {collectWorkspaceInputEdges} from '../existing-ops-workspace-source.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';
const fixed=readFixedExistingOpsGitFixture('dce0866298f5db9a17b472de3a50cfb24efff52e');
const ast=text=>parse(text,{ecmaVersion:'latest',sourceType:'module'});
const collect=async(overrides={})=>{
 const relations=[],read=async path=>overrides[path]??fixed.read(path);
 await collectBasicCiSources({read,ci:await read('.github/workflows/ci.yml'),revision:fixed.revision,relations,parse:ast,paths:fixed.paths});
 await collectDeepCiSources({read,revision:fixed.revision,relations});return relations;
};
it('当前固定main完整来源证明真实入口及固定Git，不授予历史执行结果',async()=>{
 const relations=await collect();
 expect(relations).toContainEqual(expect.objectContaining({consumer_path:'scripts/ci/run-basic-check.mjs',input_path:'apps/api/vitest.config.ts',kind:'dashboard_features_unit_config',revision:fixed.revision}));
 expect(relations.some(r=>r.kind==='scheduled_or_manual_full_postgres_entry')).toBe(true);
 expect(relations.every(r=>r.revision===fixed.revision)).toBe(true);
});
for(const path of ['.github/workflows/ci.yml','scripts/ci/run-basic-check.mjs','scripts/ci/basic-scope.mjs','scripts/ci/skill-source-tests.mjs']){
 it(`来源篡改或未知成员不能继承完整入口：${path}`,async()=>{
  const original=fixed.read(path),changed=path.endsWith('.yml')?original.replace('name:','unknown_control:'):original+'\n// unknown source\n';
  await expect(collect({[path]:changed})).rejects.toThrow();
 });
}
it('旧Engine和Quality完整历史cohort不再提供入口资格',async()=>{
 for(const revision of ['69de823cda6d789130898399c3ad770c15b6fb71','227c14e6ff8970f5c408a8dc87e8b9d0f0d16cfe']){
 const old=readFixedExistingOpsGitFixture(revision);
 await expect(collectBasicCiSources({read:async path=>old.read(path),ci:old.read('.github/workflows/ci.yml'),revision:old.revision,relations:[],parse:ast,paths:old.paths})).rejects.toThrow('basic_ci_source_unproven');
 }
});
it('当前workspace来源不向已退役Engine或Quality测试授予自动消费者资格',async()=>{
 const edges=await collectWorkspaceInputEdges({revision:fixed.revision,paths:fixed.paths,readSource:async path=>fixed.read(path),parse:ast});
 expect(edges.some(edge=>/^(?:packages\/engine|packages\/quality)\//.test(edge.dst_path))).toBe(false);
});
it('候选完整封组真实读取共享身份解析器；单成员混配与篡改均无来源资格',async()=>{
 const {readFileSync,existsSync}=await import('node:fs');
 const {execFileSync}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 const root=fileURLToPath(new URL('../../../../../',import.meta.url));
 const paths=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&existsSync(new URL(p,'file://'+root)));
 const read=async path=>readFileSync(new URL(path,'file://'+root),'utf8');
 const observe=async overrides=>{const relations=[],source=async path=>overrides[path]??read(path);await collectBasicCiSources({read:source,ci:await source('.github/workflows/ci.yml'),revision:'f'.repeat(40),relations,parse:ast,paths});return relations;};
 const relations=await observe({});
 expect(relations).toContainEqual(expect.objectContaining({consumer_path:'.github/actions/skills-source/action.yml',input_path:'scripts/skill_source_ownership.py',kind:'registered_skill_ownership_resolver'}));
 for(const path of ['.github/actions/skills-source/action.yml','scripts/skill_source_ownership.py'])await expect(observe({[path]:(await read(path))+'\n# unknown source\n'})).rejects.toThrow('basic_ci_source_unproven');
 await expect(observe({'scripts/ci/run-basic-check.mjs':fixed.read('scripts/ci/run-basic-check.mjs')})).rejects.toThrow('basic_ci_source_unproven');
 await expect(observe({'.github/workflows/ci.yml':fixed.read('.github/workflows/ci.yml')})).rejects.toThrow('basic_ci_source_unproven');
});
