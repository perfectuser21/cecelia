import {it,expect} from 'vitest';
import {parse} from 'acorn';
import {collectBasicCiSources} from '../existing-ops-stage-source.js';
import {buildExistingOpsSources} from './helpers/existing-ops-proof-builder.js';
import {readFixedExistingOpsGitFixture} from './helpers/fixed-existing-ops-git-fixture.js';
const fixed=readFixedExistingOpsGitFixture('227c14e6ff8970f5c408a8dc87e8b9d0f0d16cfe');
const build=(overrides={})=>buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision:fixed.revision,paths:fixed.paths,readSource:async path=>fixed.read(path),...overrides});
it('当前固定Git旧聚合来源缺退休入口时不再授予完整资格',async()=>{
 const result=await build();
 expect(result.revision).toBe(fixed.revision);expect(result.source_basis).toBe('fixed_git_tree');
 for(const consumer of result.consumers){expect(consumer.status).toBe('unknown');expect(consumer.bindings).toEqual([]);expect(consumer.input_relations).toEqual([]);}
 expect(result.workflows.every(w=>w.executable===false)).toBe(true);
});
it('非工厂scope、跨repo、宽路径与非固定SHA拒绝',async()=>{
 for(const override of [{scope:'cecelia'},{scope:'cecelia-kr'},{repo:'perfectuser21/zenithjoy-workspace'},{revision:'main'},
   {paths:[...fixed.paths,'packages/brain/migrations/*.sql']},{paths:[...fixed.paths,'../outside.js']},{paths:[...fixed.paths,fixed.paths[0]]}])
  await expect(build(override)).rejects.toThrow('OPS_SOURCE_INPUT_INVALID');
});
it('当前Basic实际入口来源缺失不能继承完整来源资格',async()=>{
 for(const missing of ['.github/workflows/ci.yml','scripts/ci/run-basic-check.mjs','scripts/ci/basic-scope.mjs']){
  const read=async path=>{if(path===missing)throw Error('missing fixed blob');return fixed.read(path);};
  await expect((async()=>collectBasicCiSources({read,ci:await read('.github/workflows/ci.yml'),revision:fixed.revision,paths:fixed.paths,relations:[],parse:text=>parse(text,{ecmaVersion:'latest',sourceType:'module'})}))()).rejects.toThrow();
 }
});
it('已退役Implementation入口即使存在于完整旧Git也不再取得资格',async()=>{
 const old=readFixedExistingOpsGitFixture('0464135bfdc707530513fda1f8f6bf278ffd173e');
 const f3=(await build({revision:old.revision,paths:old.paths,readSource:async path=>old.read(path)})).consumers[1];
 expect(f3.status).toBe('unknown');expect(f3.gaps).toContainEqual({code:'implementation_workflow_retired'});
 expect(f3.bindings).toEqual([]);expect(f3.input_relations).toEqual([]);
});
