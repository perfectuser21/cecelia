import { it, expect } from 'vitest';
import * as methods from '../commander-method-contract.js';
import { digest } from '../commander-v2-contract.js';
function release(revision='a'.repeat(40)) {
 const binding={kind:'code',repo:'perfectuser21/zenithjoy-workspace',path:'src/report.py',revision,digest:'sha256:'+'b'.repeat(64),status:'verified'};
 const contract={key:'report',capability_id:'cap',input_schema:{type:'object'},output_schema:{type:'object'},resources:{},recovery:{max_attempts:2},verification:{instructions:'independent'},activities:[{key:'report',executor_kind:'agent',inputs:['input'],outputs:['report'],acceptance:['actual'],implementation:{path:binding.path,revision},steps:[{key:'read',reads:['source'],writes:['run/report'],check:'hash'}]}]};
 return {id:'release',environment:'production',target:'mmv',payload:{workflows:[{id:'version',workflow_id:'workflow',payload_sha256:'c'.repeat(64),source_repo:binding.repo,source_commit:revision,payload:{contract,activities:[{reference_id:'ref',activity_id:'activity',activity_version_id:'av',slot_key:'report'}]}}],activities:[{id:'av',activity_id:'activity',source_repo:binding.repo,source_commit:revision,payload:{contract:contract.activities[0],implementation_bindings:[binding],steps:[{step_id:'step',locator:{activity_id:'activity',step_key:'read'},contract:contract.activities[0].steps[0]}]}}],components:[{kind:'repo',repo:binding.repo,revision},(({status,...b})=>b)(binding)]}};
}
it('manifest从完整冻结闭包重建，旧binding缺repo可由固定来源核对，绝不信自由映射',()=>{
 const r=release();delete r.payload.activities[0].payload.implementation_bindings[0].repo;
 const manifest=methods.methodManifest(r,'version');
 expect(manifest.bindings).toEqual(r.payload.components.filter(x=>x.kind!=='repo'));
 expect(manifest.source).toEqual({repo:'perfectuser21/zenithjoy-workspace',revision:'a'.repeat(40)});
 r.payload.components[1].digest='sha256:'+'d'.repeat(64);
 expect(()=>methods.methodManifest(r,'version')).toThrow();
});
it('只改变业务方法实现仍兼容，I/O/资源/验收/副作用/身份任一变更均拒绝',()=>{
 const original=release(),old=release('d'.repeat(40));
 expect(methods.compatibilityDigest(original,'version',old,'version')).toMatch(/^[a-f0-9]{64}$/);
 for(const mutate of [r=>r.payload.workflows[0].payload.contract.resources={device_serial:'other'},r=>r.payload.workflows[0].payload.contract.output_schema.required=['new'],r=>r.payload.activities[0].payload.contract.acceptance=['weaker'],r=>r.payload.activities[0].payload.steps[0].contract.writes=['external:publish'],r=>r.payload.activities[0].payload.steps[0].step_id='other']){
  const candidate=structuredClone(old);mutate(candidate);expect(()=>methods.compatibilityDigest(original,'version',candidate,'version')).toThrow();
 }
});
it('当前安全shell的真实字节不能通过历史方法选择回退',()=>{
 const original=release(),old=release('d'.repeat(40));
 for(const r of [original,old]){r.payload.workflows[0].payload.contract.activities[0].by='shell';r.payload.activities[0].payload.contract.by='shell';}
 old.payload.activities[0].payload.implementation_bindings[0].digest='sha256:'+'e'.repeat(64);old.payload.components[1].digest='sha256:'+'e'.repeat(64);
 expect(()=>methods.compatibilityDigest(original,'version',old,'version')).toThrow();
});
it('组合ready逐项核验当前监督器和方法实包；echo所选定义不足以ready',()=>{
 const m={supervisor_definition:{runtime_snapshot_sha256:'s'},method_instance:{manifest_sha256:'m',resolved_bindings:[{path:'p'}]}};
 const e={definition:{release_id:'r',snapshot_sha256:'h'},method_selection:m};
 const parts={protocol:'commander-composition-v1',supervisor_runtime_sha256:'s',method_manifest_sha256:'m',resolved_bindings_sha256:digest(m.method_instance.resolved_bindings)};
 e.definition.runtime_snapshot_sha256=digest(parts);
 const ready={protocol:'commander-v2',ready:true,...e.definition,...parts,protocol:'commander-v2'};
 expect(()=>methods.validateMethodReady(ready,e)).not.toThrow();
 expect(()=>methods.validateMethodReady({...ready,supervisor_runtime_sha256:'wrong'},e)).toThrow();
 expect(()=>methods.validateMethodReady({protocol:'commander-v2',ready:true,...e.definition},e)).toThrow();
});
