import { describe, it, expect } from 'vitest';
import { propsDigest } from '../../lib/notion-projection-engine.js';

const api = await import('../directory-source.js').catch(() => ({}));
const text = p => (p?.rich_text || []).map(t => t.text.content).join('');
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
  it('精确当前Step声明补输入/输出；怎么验收写人话（读什么+应该是什么+判定）；实现未核验写进「还缺什么」', () => {
    const {data,s,a}=versionedStep(),row=api.buildDirectoryRows(data,config).find(r=>r.id===s.id);
    expect(text(row.properties['输入'])).toBe('Device.serial');
    expect(text(row.properties['输出'])).toBe('Device.ready');
    expect(text(row.properties['怎么验收'])).toBe('看指标：metrics.ready；结果应 == 1；判定：设备必须已经就绪');
    expect(text(row.properties['还缺什么'])).toBe('没写：做什么、失败了怎么办\n实现未核验');
    expect(row.properties['谁来执行']).toEqual({select:{name:'AI'}});
    expect(row.gaps).toEqual([]);
    expect(row.definitionVersion.id).toBe(a.current_definition_version_id);
    for(const k of ['证据读取','实现来源','登记状态','模式','Key','验收标准','Input','Output'])expect(row.properties).not.toHaveProperty(k);
  });
  it.each(['same','different-direct','different-binding'])('引用核验只对应实际展示声明：%s', kind => {
    const {data,s,a,entry}=versionedStep();
    entry.contract.implementation={kind:'code',repo:'owner/repo',revision:'a'.repeat(40),path:'verified.sh'};
    a.definition_version.payload.implementation_bindings=[{scope:'step',step_key:'read',field:'implementation',
      status:'verified',validation_scope:'reference_only',raw:structuredClone(entry.contract.implementation)}];
    s.contract={implementation:structuredClone(entry.contract.implementation)};
    if(kind==='different-direct')s.contract.implementation='different-unverified-direct.sh';
    if(kind==='different-binding')a.definition_version.payload.implementation_bindings[0].raw={...entry.contract.implementation,path:'other.sh'};
    const missing=text(api.buildDirectoryRows(data,config).find(r=>r.id===s.id).properties['还缺什么']);
    expect(missing).toContain(kind==='same'?'实现未实跑验证':'实现未核验');
    if(kind!=='same')expect(missing).not.toContain('实现未实跑验证');
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
    expect(text(row.properties['还缺什么'])).toContain('实现没登记');
    expect(row.properties['输入'].rich_text).toEqual([]);
    expect(text(row.properties['怎么验收'])).not.toContain('判定：');
  });
  it('快照step未登记写进父Activity「还缺什么」，不新增Step；直接字段优先', () => {
    const {data,s,a}=versionedStep();
    a.definition_version.payload.steps.push({step_id:null,locator:{activity_id:a.id,step_key:'missing'},registration:null,contract:{key:'missing'}});
    s.contract={input:'直接输入',output:'直接输出',acceptance:'直接标准',implementation:'直接实现'};
    const rows=api.buildDirectoryRows(data,config),row=rows.find(r=>r.id===s.id);
    expect(rows.filter(r=>r.layer==='steps')).toHaveLength(1);
    expect(text(rows.find(r=>r.id===a.id).properties['还缺什么'])).toContain('Step 登记对不上：missing');
    for(const [field,value] of Object.entries({'输入':'直接输入','输出':'直接输出','怎么验收':'直接标准'})) expect(text(row.properties[field])).toBe(value);
    expect(text(row.properties['还缺什么'])).toContain('实现未核验');
  });
  function versionedInput() {
    const data=sample(),w=data.workflows[0];
    w.current_definition_version_id=fixtureEntityId(301);
    w.definition_version={id:w.current_definition_version_id,workflow_id:w.id,
      source_repo:'perfectuser21/zenithjoy-workspace',source_path:'product-map/contracts/keyword_acquisition.yaml',source_commit:'a'.repeat(40),
      payload:{workflow_id:w.id,contract:{trigger_inputs:['Keyword','Account','Device']}}};
    return {data,w};
  }
  it('流程行只写人看得懂的列；当前版本身份仍记录', () => {
    const {data,w}=versionedInput(),row=api.buildDirectoryRows(data,config).find(r=>r.id===w.id);
    for(const k of ['Trigger','Input','Output','执行策略','Key','版本','渠道','形态','登记状态'])expect(row.properties).not.toHaveProperty(k);
    expect(row.createProperties['名称'].title[0].text.content).toBe('流程A');
    expect(row.definitionVersion).toEqual({id:w.current_definition_version_id,source_repo:w.definition_version.source_repo,
      source_path:w.definition_version.source_path,source_commit:w.definition_version.source_commit});
  });
  it('Step 的输入/输出以 Brain steps.inputs/outputs 为准（一行一个），「顺序」写 step_order，做什么/失败了怎么办来自 action/on_fail', () => {
    const {data,s}=versionedStep();
    Object.assign(s,{inputs:['Keyword.text','Account.id'],outputs:['Video.video_id'],action:'adb tap',on_fail:'retry:3'});
    const row=api.buildDirectoryRows(data,config).find(r=>r.id===s.id);
    expect(text(row.properties['输入'])).toBe('Keyword.text\nAccount.id');
    expect(text(row.properties['输出'])).toBe('Video.video_id');
    expect(text(row.properties['做什么'])).toBe('adb tap');
    expect(text(row.properties['失败了怎么办'])).toBe('retry:3');
    expect(text(row.properties['还缺什么'])).toBe('实现未核验');
    expect(row.properties['顺序']).toEqual({number:1});
    expect(api.buildDirectoryRows(sample(),config).find(r=>r.id===fixtureEntityId(7)).properties['顺序']).toEqual({number:null});
  });
  it('怎么验收：查库/看日志/请求/断言各写成人话', () => {
    expect(api.acceptanceText({}, {type:'sql',query:'SELECT count(*) FROM x',expect:{op:'<=',value:0}})).toBe('查数据库：SELECT count(*) FROM x；结果应 <= 0');
    expect(api.acceptanceText({}, {type:'log',regex:'失败'})).toBe('看日志：匹配「失败」');
    expect(api.acceptanceText({}, {url:'https://x/y'})).toBe('请求：https://x/y');
    expect(api.acceptanceText({}, {asserts:'完整建议JSON'})).toBe('应满足：完整建议JSON');
    expect(api.acceptanceText({}, {expect:'完成'})).toBe('应：完成');
    expect(api.acceptanceText({}, {})).toBeNull();
    expect(api.acceptanceText({}, {type:'metric',ref:'metrics.a',expect:{op:'>=',ref:'metrics.b'}})).toBe('看指标：metrics.a；结果应 >= 指标 metrics.b');
  });
  it('Activity 只写 名称/承诺（FR）/输入/输出/谁来执行/还缺什么/树位置；不写 Key、正本、格子、9 项正文列', () => {
    const data=sample();Object.assign(data.activities[0],{capability_key:'cap',activity_key:'act',contract_source:'https://github.com/x/y/blob/abc/c.yaml',promise:'承诺一句'});
    const row=api.buildDirectoryRows(data,config).find(r=>r.id===fixtureEntityId(6));
    expect(Object.keys(row.properties).sort()).toEqual(['Brain ID','承诺（FR）','输入','输出','谁来执行','还缺什么','裁判结论','生产版本','树位置'].sort());
    expect(text(row.properties['承诺（FR）'])).toBe('承诺一句');
    expect(row.createProperties['名称'].title[0].text.content).toBe('共享活动');
    expect(row.gaps).toEqual([]);
  });
  it('Activity「裁判结论」取该 Activity 最新一条裁判（verdict + 连续绿），没裁判过写「未裁判」；「生产版本」发布线未接线时留空', () => {
    const data=sample();
    data.judgments=[{activity_id:fixtureEntityId(6),verdict:'converging',consecutive_green:1,required_green:3,judged_at:'2026-10-10T01:00:00Z'}];
    const row=api.buildDirectoryRows(data,config).find(r=>r.id===fixtureEntityId(6));
    expect(text(row.properties['裁判结论'])).toBe('收敛中 · 连续绿 1/3');
    expect(row.properties['生产版本']).toEqual({ rich_text: [] });
    const none=api.buildDirectoryRows(sample(),config).find(r=>r.id===fixtureEntityId(6));
    expect(text(none.properties['裁判结论'])).toBe('未裁判');
  });
  it('跨Workflow同sequence和slot的引用输入反序仍有相同 Activity 顺序和属性hash', () => {
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
    expect(text(forward.find(r => r.id === fixtureEntityId(4)).properties['Activity 顺序'])).toBe('1. 共享活动\n2. 共享活动');
  });
  it('Activity 顺序按引用顺序列名字（不显示 uuid）；引用的 Activity 不在源里时退回显示 id', () => {
    const data = sample();
    data.refs.push({ workflow_id: fixtureEntityId(4), activity_id: fixtureEntityId(66), slot_key: 'ghost', sequence_no: 3, active: true });
    expect(text(api.buildDirectoryRows(data, config).find(r => r.id === fixtureEntityId(4)).properties['Activity 顺序'])).toBe(`1. 共享活动\n3. ${fixtureEntityId(66)}`);
  });
  it('能力「状态」写中文：active→在用、deprecated→弃用', () => {
    const data = sample(); data.journeys[1].status = 'deprecated';
    expect(api.buildDirectoryRows(data, config).find(r => r.id === fixtureEntityId(3)).properties['状态']).toEqual({ select: { name: '弃用' } });
    data.journeys[1].status = 'active';
    expect(api.buildDirectoryRows(data, config).find(r => r.id === fixtureEntityId(3)).properties['状态']).toEqual({ select: { name: '在用' } });
  });
  it('显式binding分别固定两个模型名称，不要求同名；KR asserts不能丢',()=>{
    const data=sample();data.journeys[0].name='工厂价值流';data.map_nodes[0].name='工厂';
    data.steps[0].readback={asserts:'完整建议JSON',implementation:'repo#run'};
    const rows=api.buildDirectoryRows(data,{value_stream_bindings:[{...config.value_stream_bindings[0],expected_node_name:'工厂',expected_journey_name:'工厂价值流'}]});
    expect(rows.find(r=>r.id===fixtureEntityId(2)).pageId).toBe(fixtureEntityId(102));
    expect(text(rows.find(r=>r.id===fixtureEntityId(7)).properties['怎么验收'])).toBe('应满足：完整建议JSON');
    expect(rows.find(r=>r.id===fixtureEntityId(4)).gaps).toEqual([]);
  });
  it('导出独立源映射入口', () => expect(api.buildDirectoryRows).toBeTypeOf('function'));
  it('共享活动挂所有 active 引用的流程；Step 只挂所属 Activity', () => {
    const rows = api.buildDirectoryRows(sample(), config);
    expect(rows.find(r => r.id === fixtureEntityId(6)).relations['所属流程']).toEqual([
      { layer: 'workflows', id: fixtureEntityId(4) }, { layer: 'workflows', id: fixtureEntityId(5) },
    ]);
    expect(rows.find(r => r.id === fixtureEntityId(7)).relations).toEqual({ '所属Activity': [{ layer: 'activities', id: fixtureEntityId(6) }] });
  });
  it('价值流由目录接管：挂了能力的价值流没绑旧地图页也许可新建（按 Brain ID 找页，不凭同名认领），名字/说明来自 Brain', () => {
    const data = sample(); data.journeys[0].description = '从产品到交付';
    const vs = api.buildDirectoryRows(data, {}).find(r => r.id === fixtureEntityId(2));
    expect(vs.pageId).toBeNull(); expect(vs.allowCreate).toBe(true);
    expect(vs.gaps).toEqual([]);
    expect(vs.createProperties['名称'].title[0].text.content).toBe('产品');
    expect(text(vs.properties['说明'])).toBe('从产品到交付');
    expect(vs.relations['能力']).toEqual([{ layer: 'capabilities', id: fixtureEntityId(3) }]);
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
  it('Areas只写机器列，不改Name、Parent、负责人；任何层都不写登记缺口/同步时间', () => {
    const rows = api.buildDirectoryRows(sample(), config);
    const area = rows.find(r => r.layer === 'areas');
    expect(Object.keys(area.properties)).toEqual(['Brain ID']);
    for (const r of rows) for (const k of ['登记缺口', '同步时间', '责任主体', '真身来源']) expect(r.properties, `${r.layer}.${k}`).not.toHaveProperty(k);
  });
  it('缺实现声明写进还缺什么；关系移除生成已知空数组', () => {
    const data = sample(); data.refs = [];
    const rows = api.buildDirectoryRows(data, config);
    expect(text(rows.find(r => r.id === fixtureEntityId(7)).properties['还缺什么'])).toContain('实现没登记');
    expect(rows.find(r => r.id === fixtureEntityId(4)).relations['Activity']).toEqual([]);
  });
});
