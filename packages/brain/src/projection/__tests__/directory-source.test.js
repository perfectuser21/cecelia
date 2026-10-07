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
  it('Activity 行不信任旧同步留下的 notion_id（可能指向别的库/回收站里的页），页面身份只认目录链接与 Brain ID 查询', () => {
    const data = sample();
    data.activities[0].notion_id = fixtureEntityId(999);
    const rows = api.buildDirectoryRows(data, config);
    expect(rows.find(r => r.layer === 'activities').pageId).toBeNull();
    expect(rows.find(r => r.layer === 'areas').pageId).toBe(fixtureEntityId(101)); // 部门页是人建的，旧 notion_id 就是它
  });
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
  it.each(['same','different-direct','different-binding'])('引用核验只对应实际展示声明：%s', kind => {
    const {data,s,a,entry}=versionedStep();
    entry.contract.implementation={kind:'code',repo:'owner/repo',revision:'a'.repeat(40),path:'verified.sh'};
    a.definition_version.payload.implementation_bindings=[{scope:'step',step_key:'read',field:'implementation',
      status:'verified',validation_scope:'reference_only',raw:structuredClone(entry.contract.implementation)}];
    s.contract={implementation:structuredClone(entry.contract.implementation)};
    if(kind==='different-direct')s.contract.implementation='different-unverified-direct.sh';
    if(kind==='different-binding')a.definition_version.payload.implementation_bindings[0].raw={...entry.contract.implementation,path:'other.sh'};
    const row=api.buildDirectoryRows(data,config).find(r=>r.id===s.id);
    const evidence=JSON.parse(row.properties['证据读取'].rich_text[0].text.content);
    expect(evidence.definition.implementation_status).toBe(kind==='same'?'reference_verified':'unverified');
    expect(row.gaps).toContain(kind==='same'?'implementation_execution_unverified':'implementation_unverified');
    if(kind!=='same')expect(row.gaps).not.toContain('implementation_execution_unverified');
    expect(row.properties['实现来源'].rich_text[0].text.content).toBe(typeof s.contract.implementation==='string'?
      s.contract.implementation:JSON.stringify(s.contract.implementation));
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
  it('流程行不写 Brain 没有的列（Trigger/Input/Output/执行策略），也不再报这几条恒定缺口；当前版本身份仍记录', () => {
    const {data,w}=versionedInput(),row=api.buildDirectoryRows(data,config).find(r=>r.id===w.id);
    for(const k of ['Trigger','Input','Output','执行策略'])expect(row.properties).not.toHaveProperty(k);
    for(const g of ['workflow_input_undeclared','workflow_trigger_undeclared','workflow_output_undeclared','execution_policy_undeclared'])expect(row.gaps).not.toContain(g);
    expect(row.definitionVersion).toEqual({id:w.current_definition_version_id,source_repo:w.definition_version.source_repo,
      source_path:w.definition_version.source_path,source_commit:w.definition_version.source_commit});
  });
  it('Step 的 Input/Output 以 Brain steps.inputs/outputs 为准，「顺序」写 step_order', () => {
    const {data,s}=versionedStep();
    Object.assign(s,{inputs:['Keyword.text'],outputs:['Video.video_id']});
    const row=api.buildDirectoryRows(data,config).find(r=>r.id===s.id);
    expect(row.properties.Input.rich_text[0].text.content).toBe('["Keyword.text"]');
    expect(row.properties.Output.rich_text[0].text.content).toBe('["Video.video_id"]');
    expect(row.properties['顺序']).toEqual({number:1});
    expect(api.buildDirectoryRows(sample(),config).find(r=>r.id===fixtureEntityId(7)).properties['顺序']).toEqual({number:null});
  });
  it('Activity 写业务 Key（能力.活动）与 git 正本链接；不再写使用位置/责任主体', () => {
    const data=sample();Object.assign(data.activities[0],{capability_key:'cap',activity_key:'act',contract_source:'https://github.com/x/y/blob/abc/c.yaml'});
    const row=api.buildDirectoryRows(data,config).find(r=>r.id===fixtureEntityId(6));
    expect(row.properties.Key.rich_text[0].text.content).toBe('cap.act');
    expect(row.properties['正本（只读·改请走 git）']).toEqual({url:'https://github.com/x/y/blob/abc/c.yaml'});
    for(const k of ['使用位置','责任主体','真身来源'])expect(row.properties).not.toHaveProperty(k);
    expect(row.gaps).not.toContain('contract_missing');
    const bare=api.buildDirectoryRows(sample(),config).find(r=>r.id===fixtureEntityId(6));
    expect(bare.properties.Key.rich_text).toEqual([]);expect(bare.properties['正本（只读·改请走 git）']).toEqual({url:null});
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
    expect(forward.find(r => r.id === fixtureEntityId(4)).properties['活动编排'].rich_text[0].text.content).toBe('1. 共享活动\n2. 共享活动');
  });
  it('活动编排按顺序列 Activity 名字（不再显示 uuid）；引用的 Activity 不在源里时退回显示 id', () => {
    const data = sample();
    data.refs.push({ workflow_id: fixtureEntityId(4), activity_id: fixtureEntityId(66), slot_key: 'ghost', sequence_no: 3, active: true });
    const text = api.buildDirectoryRows(data, config).find(r => r.id === fixtureEntityId(4)).properties['活动编排'].rich_text[0].text.content;
    expect(text).toBe(`1. 共享活动\n3. ${fixtureEntityId(66)}`);
  });
  it('显式binding分别固定两个模型名称，不要求同名；KR asserts不能丢',()=>{
    const data=sample();data.journeys[0].name='工厂价值流';data.map_nodes[0].name='工厂';
    data.steps[0].readback={asserts:'完整建议JSON',implementation:'repo#run'};
    const rows=api.buildDirectoryRows(data,{value_stream_bindings:[{...config.value_stream_bindings[0],expected_node_name:'工厂',expected_journey_name:'工厂价值流'}]});
    expect(rows.find(r=>r.id===fixtureEntityId(2)).pageId).toBe(fixtureEntityId(102));
    expect(rows.find(r=>r.id===fixtureEntityId(7)).properties['验收标准'].rich_text[0].text.content).toBe('完整建议JSON');
    expect(rows.find(r=>r.id===fixtureEntityId(4)).gaps).toEqual([]);
  });
  it('导出独立源映射入口', () => expect(api.buildDirectoryRows).toBeTypeOf('function'));
  it('共享活动和步骤使用所有active引用，保真身ID而非legacy单父', () => {
    const rows = api.buildDirectoryRows(sample(), config);
    expect(rows.find(r => r.id === fixtureEntityId(6)).relations['所属Workflows']).toEqual([
      { layer: 'workflows', id: fixtureEntityId(4) }, { layer: 'workflows', id: fixtureEntityId(5) },
    ]);
    expect(rows.find(r => r.id === fixtureEntityId(7)).relations['所属Workflows']).toHaveLength(2);
  });
  it('价值流由目录接管：挂了能力的价值流没绑旧地图页也许可新建（按 Brain ID 找页，不凭同名认领），名字/说明来自 Brain', () => {
    const data = sample(); data.journeys[0].description = '从产品到交付';
    const vs = api.buildDirectoryRows(data, {}).find(r => r.id === fixtureEntityId(2));
    expect(vs.pageId).toBeNull(); expect(vs.allowCreate).toBe(true);
    expect(vs.gaps).toEqual([]);
    expect(vs.createProperties.Name.title[0].text.content).toBe('产品');
    expect(vs.properties['说明'].rich_text[0].text.content).toBe('从产品到交付');
    expect(api.buildDirectoryRows(sample(), {}).find(r => r.id === fixtureEntityId(3)).relations['所属价值流']).toEqual([{ layer: 'value_streams', id: fixtureEntityId(2) }]);
  });
  it('没挂能力的空壳价值流不建页：标 value_stream_empty，部门的「价值流」关联也不连它（否则永远连不上）', () => {
    const data = sample(); data.journeys.push({ id: fixtureEntityId(20), name: '空壳', kind: 'value_stream', area_id: fixtureEntityId(1) });
    const rows = api.buildDirectoryRows(data, {});
    const shell = rows.find(r => r.id === fixtureEntityId(20));
    expect(shell.allowCreate).toBe(false); expect(shell.gaps).toEqual(['value_stream_empty']);
    expect(rows.find(r => r.layer === 'areas').relations['价值流']).toEqual([{ layer: 'value_streams', id: fixtureEntityId(2) }]);
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
    for (const r of rows) for (const k of ['责任主体', '真身来源', 'Key']) if (r.layer === 'areas' || k !== 'Key') expect(r.properties, `${r.layer}.${k}`).not.toHaveProperty(k);
    expect(rows.find(r => r.id === fixtureEntityId(6)).properties['执行主体'].rich_text[0].text.content).toBe('agent');
  });
  it('缺实现声明保留gap；关系移除生成已知空数组', () => {
    const data = sample(); data.refs = [];
    const rows = api.buildDirectoryRows(data, config);
    expect(rows.find(r => r.id === fixtureEntityId(7)).gaps).toContain('implementation_unknown');
    expect(rows.find(r => r.id === fixtureEntityId(4)).relations.Activities).toEqual([]);
  });
});
