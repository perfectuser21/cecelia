import {it,expect} from 'vitest';
import {scriptRuntimeIdentity} from '../script-run-definition.js';
import {PATROL_REPO} from '../device-patrol-admission.js';
const phone='4f899cab6425341646e27c5fca20979b8ac42be7',control='f38c5a5635d2f57554efcfee4b09163d10cfe39b';
function fixture(recovery=false){
  const command='/usr/bin/python3 /Users/administrator/.local/share/infra-workflow-commander/releases/'+control+'/openclaw_native.py '+(recovery?'recovery-phone --demand-task-id 11111111-1111-4111-8111-111111111111 --serial phone-a':'maintain')+' --execution-script "$0"';
  const spec={host:'us-mac-m4',cmd:command,cwd:null,env:{},timeout_sec:1200,artifact_paths:[]};
  const bindings=[{kind:'code',repo:PATROL_REPO,revision:phone,path:'scripts/phone-account-patrol/runner.py',digest:'sha256:'+'a'.repeat(64),status:'verified'},
    {kind:'code',repo:PATROL_REPO,revision:control,path:'scripts/phone-account-patrol/openclaw_native.py',digest:'sha256:'+'b'.repeat(64),status:'verified'}];
  return {task:{id:'fixture-task',payload:{source_revision:recovery?phone:control,phone_source_revision:phone,...(recovery?{control_source_revision:control}:{}),phone_serial:'phone-a'}},spec,
    release:{id:'fixture-release',manifest_sha256:'c'.repeat(64),target:'mmv:/Users/administrator/.local/share/phone-account-patrol/releases/'+phone,payload:{components:bindings}},
    workflow:{id:'definition-fixture',workflow_id:'workflow-fixture',payload:{registration_protocol:'definition-freeze-v1',contract:{input_schema:{properties:{source_revision:{enum:[phone,control]},phone_source_revision:{const:phone},control_source_revision:{const:control}}},runtime:{script:{host:'mmv',cwd:null,env:{},commands:[command]}}}}},
    activities:[{payload:{implementation_bindings:bindings}}]};
}
const identity=f=>scriptRuntimeIdentity(f.task,f.spec,f.release,f.workflow,f.activities,'script-fixture-a1',true);
it('现有maintenance不带control_source字段时，由已核验控制入口得到真实f38',()=>{
  const value=identity(fixture());expect(value.control_source_revision).toBe(control);expect(value.phone_source_revision).toBe(phone);
});
it('旧恢复任务source仍4f，实际控制入口f38不得误绑成4f代码',()=>{
  const f=fixture(true),value=identity(f);expect(value.control_source_revision).toBe(control);expect(f.task.payload.source_revision).toBe(phone);
});
it('显式控制来源与已冻结入口不一致仍拒绝',()=>{
  const f=fixture();f.task.payload.control_source_revision='e'.repeat(40);expect(()=>identity(f)).toThrow();
});
it('多入口中不适用的恢复模板参数缺失不阻塞合法直接phone入口',()=>{
  const f=fixture();const recovery=f.spec.cmd.replace('maintain','recovery-phone --demand-task-id {{recovery_demand_id}} --serial {{phone_serial}}');
  const direct='/usr/bin/python3 /Users/administrator/.local/share/phone-account-patrol/releases/'+phone+'/runner.py phone --serial phone-a --execution-script "$0"';
  f.spec.cmd=direct;f.task.payload.source_revision=phone;
  f.workflow.payload.contract.runtime.script.commands=[recovery,direct];
  expect(identity(f).phone_source_revision).toBe(phone);
});

it('旧定义的864诊断组件不能充当适用864手机主执行的证明',()=>{
  const f=fixture(true),newPhone='864154c57e88e8085d2add741a79103a28891a44';
  f.task.payload.phone_source_revision=newPhone;f.release.target=f.release.target.replace(phone,newPhone);
  const diagnostic={...f.activities[0].payload.implementation_bindings[0],revision:newPhone};
  f.activities[0].payload.implementation_bindings.push(diagnostic);
  expect(()=>identity(f)).toThrow();
});
it.each(['source_revision','control_source_revision'])('实际%s不满足固定输入const/enum时拒绝',field=>{
  const f=fixture(true);
  if(field==='source_revision')f.task.payload.source_revision='e'.repeat(40);
  else f.workflow.payload.contract.input_schema.properties.control_source_revision={const:'e'.repeat(40)};
  expect(()=>identity(f)).toThrow();
});
it('恢复模板UUID参数必须是真字符串，数组字符串化不能冒充需求身份',()=>{
  const f=fixture(true),id='11111111-1111-4111-8111-111111111111';
  f.workflow.payload.contract.runtime.script.commands=[f.spec.cmd.replace(id,'{{recovery_demand_id}}')];
  f.task.payload.recovery_demand_id=[id];
  expect(()=>identity(f)).toThrow();
});

const currentPhone='864154c57e88e8085d2add741a79103a28891a44';
function compatibleFixture(entryRevision,phoneRevision=entryRevision,mode='phone'){
  const f=fixture(true),contract=f.workflow.payload.contract;
  const binding={...f.activities[0].payload.implementation_bindings[0],revision:currentPhone};
  f.activities[0].payload.implementation_bindings.push(binding);
  // The same immutable definition covers both genuinely installed releases.
  contract.input_schema.properties.source_revision={enum:[phone,currentPhone,control]};
  contract.input_schema.properties.phone_source_revision={enum:[phone,currentPhone]};
  f.task.payload.source_revision=entryRevision;
  f.task.payload.phone_source_revision=phoneRevision;
  f.release.target=f.release.target.replace(phone,phoneRevision);
  const command=`/usr/bin/python3 /Users/administrator/.local/share/phone-account-patrol/releases/${entryRevision}/runner.py ${mode}${mode==='phone'?' --serial phone-a':''} --execution-script "$0"`;
  f.spec.cmd=command;contract.runtime.script.commands=[command];
  return f;
}
it.each(['phone','batch'].flatMap(mode=>[[mode,phone,currentPhone],[mode,currentPhone,phone]]))(
  '兼容定义的%s直接入口不能交叉：entry=%s phone=%s',(mode,entryRevision,phoneRevision)=>{
  expect(()=>identity(compatibleFixture(entryRevision,phoneRevision,mode))).toThrow();
});
it.each(['phone','batch'])('兼容定义的%s直接入口按各自真实target保留4f及864',mode=>{
  for(const revision of [phone,currentPhone]){
    const result=identity(compatibleFixture(revision,revision,mode));
    expect(result.entry_source_revision).toBe(revision);
    expect(result.phone_source_revision).toBe(revision);
  }
});
for(const kind of ['outside','prefix','traversal'])it(`固定basename不能冒充真实安装入口：${kind}`,()=>{
  const f=compatibleFixture(currentPhone),target=f.release.target.slice(f.release.target.indexOf(':')+1);
  const entry={outside:`/tmp/releases/${currentPhone}/runner.py`,
    prefix:`${target}-shadow/releases/${currentPhone}/runner.py`,
    traversal:`${target}/../shadow/releases/${currentPhone}/runner.py`}[kind];
  f.spec.cmd=f.spec.cmd.replace(target+'/runner.py',entry);
  f.workflow.payload.contract.runtime.script.commands=[f.spec.cmd];
  expect(()=>identity(f)).toThrow();
});
it.each([phone,currentPhone])('兼容定义的native恢复保持真实phone与original_scope：%s',revision=>{
  const f=compatibleFixture(revision),recovery=fixture(true).spec.cmd;
  f.spec.cmd=recovery;f.workflow.payload.contract.runtime.script.commands=[recovery];
  f.task.payload.original_scope={phone_source_revision:revision};
  const result=identity(f);
  expect(result.entry_source_revision).toBe(control);
  expect(result.phone_source_revision).toBe(revision);
  expect(f.task.payload.source_revision).toBe(revision);
  f.task.payload.original_scope.phone_source_revision=revision===phone?currentPhone:phone;
  expect(()=>identity(f)).toThrow();
});
