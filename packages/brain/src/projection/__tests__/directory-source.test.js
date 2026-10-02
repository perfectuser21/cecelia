import { describe, it, expect } from 'vitest';
import { propsDigest } from '../../lib/notion-projection-engine.js';

const api = await import('../directory-source.js').catch(() => ({}));
const fixtureEntityId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function sample() {
  return {
    areas: [{ id: fixtureEntityId(1), name: '部门', notion_id: fixtureEntityId(101) }],
    journeys: [{ id: fixtureEntityId(2), name: '产品', kind: 'value_stream', area_id: fixtureEntityId(1) },
      { id: fixtureEntityId(3), name: '能力', kind: 'capability', parent_journey_id: fixtureEntityId(2), area_id: null }],
    workflows: [{ id: fixtureEntityId(4), key: 'a', name: '流程A', capability_id: fixtureEntityId(3) },
      { id: fixtureEntityId(5), key: 'b', name: '流程B', capability_id: fixtureEntityId(3) }],
    activities: [{ id: fixtureEntityId(6), name: '共享活动', workflow_id: fixtureEntityId(4), executor_kind: 'agent', contract: {} }],
    steps: [{ id: fixtureEntityId(7), activity_id: fixtureEntityId(6), key: 'read', active: true, readback: { expect: '完成' } }],
    refs: [{ workflow_id: fixtureEntityId(4), activity_id: fixtureEntityId(6), slot_key: 'first', sequence_no: 1, active: true },
      { workflow_id: fixtureEntityId(5), activity_id: fixtureEntityId(6), slot_key: 'second', sequence_no: 2, active: true }],
    map_nodes: [{ scope: 'cecelia', node_key: 'product', name: '产品', notion_id: fixtureEntityId(102), active: true }],
  };
}
const config = { value_stream_bindings: [{ journey_id: fixtureEntityId(2), scope: 'cecelia', node_key: 'product' }] };
describe('六层目录源映射', () => {
  function versionedStep() {
    const data=sample(),s=data.steps[0],a=data.activities[0];
    Object.assign(s,{key:'cap.stage.read',step_order:1,mode:'checkpoint',source_sha256:'b'.repeat(64),
      readback:{type:'metric',ref:'metrics.ready',expect:{op:'==',value:1}}});
    Object.assign(a,{capability_key:'cap',activity_key:'stage',current_definition_version_id:fixtureEntityId(401)});
    const contract={key:'read',name:'读取',order:1,reads:['Device.serial'],writes:['Device.ready'],check:'设备必须已经就绪',
      implementation:{status:'implemented',ref:'runner.sh read'},dod:{mode:'checkpoint',readback:{type:'metric',ref:'metrics.ready'}}};
    const entry={step_id:s.id,locator:{activity_id:a.id,step_key:'read'},contract,
      registration:{id:s.id,key:s.key,step_order:s.step_order,mode:s.mode,readback:s.readback,source_sha256:s.source_sha256}};
    a.definition_version={id:a.current_definition_version_id,activity_id:a.id,source_commit:'c'.repeat(40),
      payload:{activity_id:a.id,contract:{steps:[contract]},steps:[entry],implementation_bindings:[
        {scope:'activity',status:'verified',validation_scope:'reference_only'},
        {scope:'step',step_key:'read',field:'implementation',kind:'raw',status:'unresolved',raw:contract.implementation}]}};
    return {data,s,a,entry};
  }
  it('精确当前Step声明补Input/Output/实现且保持未核验，原expect与canonical check/dod都展示', () => {
    const {data,s,a,entry}=versionedStep(),row=api.buildDirectoryRows(data,config).find(r=>r.id===s.id);
    expect(row.properties.Input.rich_text[0].text.content).toBe('["Device.serial"]');
    expect(row.properties.Output.rich_text[0].text.content).toBe('["Device.ready"]');
    expect(JSON.parse(row.properties['实现来源'].rich_text[0].text.content)).toEqual(entry.contract.implementation);
    expect(row.gaps).not.toContain('implementation_unknown');expect(row.gaps).toContain('implementation_unverified');
    expect(JSON.parse(row.properties['验收标准'].rich_text[0].text.content)).toEqual(s.readback.expect);
    const evidence=JSON.parse(row.properties['证据读取'].rich_text[0].text.content);
    expect(evidence.expect).toEqual(s.readback.expect);
    expect(evidence.definition).toMatchObject({check:entry.contract.check,dod:entry.contract.dod,implementation_status:'unverified'});
    expect(row.definitionVersion.id).toBe(a.current_definition_version_id);
  });
  it.each(['wrong-activity','wrong-version','wrong-step','wrong-locator','registration-key','registration-sha','registration-readback','duplicate','no-pointer'])('Step %s不接受声明且不从Activity继承实现', kind => {
    const {data,s,a,entry}=versionedStep();
    if(kind==='wrong-activity')a.definition_version.activity_id=fixtureEntityId(999);
    if(kind==='wrong-version')a.definition_version.id=fixtureEntityId(999);
    if(kind==='wrong-step')entry.step_id=fixtureEntityId(999);
    if(kind==='wrong-locator')entry.locator.activity_id=fixtureEntityId(999);
    if(kind==='registration-key')entry.registration.key='other';
    if(kind==='registration-sha')entry.registration.source_sha256='d'.repeat(64);
    if(kind==='registration-readback')entry.registration.readback={type:'none'};
    if(kind==='duplicate')a.definition_version.payload.steps.push(structuredClone(entry));
    if(kind==='no-pointer')a.current_definition_version_id=null;
    const row=api.buildDirectoryRows(data,config).find(r=>r.id===s.id);
    expect(row.properties['实现来源'].rich_text).toEqual([]);expect(row.gaps).toContain('implementation_unknown');
    expect(row.properties.Input.rich_text).toEqual([]);
  });
  it('快照step未登记仅父Activity标gap，不新增Step；直接字段优先仍保canonical证据', () => {
    const {data,s,a,entry}=versionedStep();
    a.definition_version.payload.steps.push({step_id:null,locator:{activity_id:a.id,step_key:'missing'},registration:null,contract:{key:'missing'}});
    s.contract={input:'直接输入',output:'直接输出',acceptance:'直接标准',implementation:'直接实现'};
    const rows=api.buildDirectoryRows(data,config),row=rows.find(r=>r.id===s.id);
    expect(rows.filter(r=>r.layer==='steps')).toHaveLength(1);
    expect(rows.find(r=>r.id===a.id).gaps).toContain('step_registration_unresolved:missing');
    for(const [field,value] of Object.entries({Input:'直接输入',Output:'直接输出','验收标准':'直接标准','实现来源':'直接实现'}))
      expect(row.properties[field].rich_text[0].text.content).toBe(value);
    expect(JSON.parse(row.properties['证据读取'].rich_text[0].text.content).definition.check).toBe(entry.contract.check);
    expect(row.gaps).toContain('implementation_unverified');
  });
  function versionedInput() {
    const data=sample(),w=data.workflows[0];
    w.current_definition_version_id=fixtureEntityId(301);
    w.definition_version={id:w.current_definition_version_id,workflow_id:w.id,
      source_repo:'perfectuser21/zenithjoy-workspace',source_path:'product-map/contracts/keyword_acquisition.yaml',source_commit:'a'.repeat(40),
      payload:{workflow_id:w.id,contract:{trigger_inputs:['Keyword','Account','Device']}}};
    return {data,w};
  }
  it('当前版本契约trigger_inputs映射Input并清缺口，保内部来源且不推导Trigger/Output/策略', () => {
    const {data,w}=versionedInput(),row=api.buildDirectoryRows(data,config).find(r=>r.id===w.id);
    expect(row.properties.Input.rich_text[0].text.content).toBe('["Keyword","Account","Device"]');
    expect(row.gaps).not.toContain('workflow_input_undeclared');
    expect(row.gaps).toEqual(expect.arrayContaining(['workflow_trigger_undeclared','workflow_output_undeclared','execution_policy_undeclared']));
    expect(row.definitionVersion).toEqual({id:w.current_definition_version_id,source_repo:w.definition_version.source_repo,
      source_path:w.definition_version.source_path,source_commit:w.definition_version.source_commit});
  });
  it.each(['text','empty','duplicate','not-string','bad-type','wrong-object','wrong-version','wrong-payload','no-pointer','kr'])('当前版本%s不伪造Input', kind => {
    const {data,w}=versionedInput(),v=w.definition_version;
    if(kind==='text')v.payload.contract.trigger_inputs='Keyword';
    if(kind==='empty')v.payload.contract.trigger_inputs=[];
    if(kind==='duplicate')v.payload.contract.trigger_inputs=['Keyword','Keyword'];
    if(kind==='not-string')v.payload.contract.trigger_inputs=[1];
    if(kind==='bad-type')v.payload.contract.trigger_inputs=[' keyword '];
    if(kind==='wrong-object')v.workflow_id=fixtureEntityId(302);
    if(kind==='wrong-version')v.id=fixtureEntityId(302);
    if(kind==='wrong-payload')v.payload.workflow_id=fixtureEntityId(302);
    if(kind==='no-pointer')w.current_definition_version_id=null;
    if(kind==='kr')v.payload.contract={runtime:{},steps:[],activities:[]};
    const row=api.buildDirectoryRows(data,config).find(r=>r.id===w.id);
    expect(row.properties.Input.rich_text).toEqual([]);
    expect(row.gaps).toContain('workflow_input_undeclared');
  });
  it.each(['direct','contract','explicit-empty'])('已有%s Input优先，不让版本契约覆盖直接声明', kind => {
    const {data,w}=versionedInput();
    if(kind==='direct')w.input='原输入';
    if(kind==='contract')w.contract={inputs:['Existing']};
    if(kind==='explicit-empty')w.input='';
    const row=api.buildDirectoryRows(data,config).find(r=>r.id===w.id);
    expect(row.properties.Input.rich_text).toEqual(kind==='explicit-empty'?[]:[{text:{content:kind==='direct'?'原输入':'["Existing"]'}}]);
  });
  it('跨Workflow同sequence和slot的引用输入反序仍有相同使用位置、编排和属性hash', () => {
    const data = sample();
    data.refs = [
      { workflow_id: fixtureEntityId(5), activity_id: fixtureEntityId(6), slot_key: 'same', sequence_no: 1, active: true },
      { workflow_id: fixtureEntityId(4), activity_id: fixtureEntityId(6), slot_key: 'same', sequence_no: 1, active: true },
      { workflow_id: fixtureEntityId(4), activity_id: fixtureEntityId(6), slot_key: 'later', sequence_no: 2, active: true },
    ];
    const forward = api.buildDirectoryRows(data, config);
    const reverse = api.buildDirectoryRows({ ...data, refs: [...data.refs].reverse() }, config);
    const properties = rows => rows.map(r => ({ id: r.id, properties: r.properties }));
    expect(properties(reverse)).toEqual(properties(forward));
    expect(reverse.map(r => propsDigest(r.properties))).toEqual(forward.map(r => propsDigest(r.properties)));
    expect(forward.find(r => r.id === fixtureEntityId(6)).properties['使用位置'].rich_text[0].text.content).toBe(
      `${fixtureEntityId(4)} / same / 1\n${fixtureEntityId(5)} / same / 1\n${fixtureEntityId(4)} / later / 2`);
    expect(forward.find(r => r.id === fixtureEntityId(4)).properties['活动编排'].rich_text[0].text.content).toBe(
      `1. same → ${fixtureEntityId(6)}\n2. later → ${fixtureEntityId(6)}`);
  });
  it('显式binding分别固定两个模型名称，不要求同名；KR asserts不能丢',()=>{
    const data=sample();data.journeys[0].name='工厂价值流';data.map_nodes[0].name='工厂';
    data.steps[0].readback={asserts:'完整建议JSON',implementation:'repo#run'};
    const rows=api.buildDirectoryRows(data,{value_stream_bindings:[{...config.value_stream_bindings[0],expected_node_name:'工厂',expected_journey_name:'工厂价值流'}]});
    expect(rows.find(r=>r.id===fixtureEntityId(2)).pageId).toBe(fixtureEntityId(102));
    expect(rows.find(r=>r.id===fixtureEntityId(7)).properties['验收标准'].rich_text[0].text.content).toBe('完整建议JSON');
    expect(rows.find(r=>r.id===fixtureEntityId(4)).gaps).toEqual(expect.arrayContaining(['workflow_trigger_undeclared','workflow_input_undeclared','workflow_output_undeclared']));
  });
  it('导出独立源映射入口', () => expect(api.buildDirectoryRows).toBeTypeOf('function'));
  it('共享活动和步骤使用所有active引用，保真身ID而非legacy单父', () => {
    const rows = api.buildDirectoryRows(sample(), config);
    expect(rows.find(r => r.id === fixtureEntityId(6)).relations['所属Workflows']).toEqual([
      { layer: 'workflows', id: fixtureEntityId(4) }, { layer: 'workflows', id: fixtureEntityId(5) },
    ]);
    expect(rows.find(r => r.id === fixtureEntityId(7)).relations['所属Workflows']).toHaveLength(2);
    expect(rows.find(r => r.id === fixtureEntityId(6)).properties['使用位置'].rich_text[0].text.content).toContain('second');
  });
  it('无显式绑定不凭同名认领价值流，也不许可新建该层页', () => {
    const vs = api.buildDirectoryRows(sample(), {}).find(r => r.id === fixtureEntityId(2));
    expect(vs.pageId).toBeNull(); expect(vs.allowCreate).toBe(false);
    expect(vs.gaps).toContain('value_stream_binding_missing');
  });
  it('绑定来源名不匹配、失活或重复都拒绝', () => {
    const data = sample(); data.map_nodes[0].name = '其它';
    expect(() => api.buildDirectoryRows(data, config)).toThrow(/绑定/);
    data.map_nodes[0].name = '产品'; data.map_nodes[0].active = false;
    expect(() => api.buildDirectoryRows(data, config)).toThrow(/绑定/);
    expect(() => api.buildDirectoryRows(sample(), { value_stream_bindings: [...config.value_stream_bindings, ...config.value_stream_bindings] })).toThrow(/重复/);
  });
  it('Areas只写机器列，不改Name、Parent、负责人；执行体不是负责人', () => {
    const rows = api.buildDirectoryRows(sample(), config);
    const area = rows.find(r => r.layer === 'areas');
    expect(area.properties).not.toHaveProperty('Name'); expect(area.properties).not.toHaveProperty('Parent');
    expect(area.properties).not.toHaveProperty('负责人');
    expect(rows.find(r => r.id === fixtureEntityId(6)).properties['责任主体'].rich_text[0].text.content).toBe('unknown');
  });
  it('缺实现声明保留gap；关系移除生成已知空数组', () => {
    const data = sample(); data.refs = [];
    const rows = api.buildDirectoryRows(data, config);
    expect(rows.find(r => r.id === fixtureEntityId(7)).gaps).toContain('implementation_unknown');
    expect(rows.find(r => r.id === fixtureEntityId(4)).relations.Activities).toEqual([]);
  });
});
