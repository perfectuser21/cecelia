/**
 * Activity 页 15 列 + 8 格颜色、Step 页 8 列（树+仓库 v3.0 第 3 刀）：Brain 真身 → Notion 目录库的机器列。
 * 人只拍板三问，其余全由机器写；列名固定，格子颜色来自 activity_cells 的 8 个标准格。
 */
import { describe, it, expect } from 'vitest';
import { buildDirectoryRows } from '../directory-source.js';
import { buildDirectorySchemas } from '../directory-schema.js';
import { ACTIVITY_CARD_COLUMNS, CELL_COLUMNS, buildActivityCardProps, buildStepCardProps } from '../activity-card.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const text = p => p.rich_text.map(t => t.text.content).join('');

function sample(cells) {
  return {
    areas: [{ id: id(1), name: '部门', notion_id: id(101) }],
    journeys: [{ id: id(2), name: '产品', kind: 'value_stream', area_id: id(1) },
      { id: id(3), name: '能力', kind: 'capability', parent_journey_id: id(2) }],
    workflows: [{ id: id(4), key: 'a', name: '流程A', capability_id: id(3) }],
    activities: [{
      id: id(6), name: '采集', workflow_id: id(4), executor_kind: 'code', contract: {},
      promise: '每轮采到新的视频', inputs: [{ type: 'Video' }], outputs: [{ type: 'Lead' }], preconditions: ['设备在线'],
      invariants: ['不重复入库'], nfr: { timeout_s: 600 }, failure: { fatal: ['登录失效'] }, readback: { sql: 'select 1' },
      judgment: [{ point: '登录态', harm: '误判=整批丢' }], adversarial: '平台改版', shelf_life_days: 14,
    }],
    steps: [{ id: id(7), activity_id: id(6), key: 'read', active: true, readback: { expect: '完成' },
      name: '读设备', action: 'adb shell dumpsys', inputs: ['serial'], outputs: ['ready'], on_fail: 'retry:3', mode: 'action' }],
    refs: [{ workflow_id: id(4), activity_id: id(6), slot_key: 'first', sequence_no: 1, active: true }],
    map_nodes: [{ scope: 'cecelia', node_key: 'product', name: '产品', notion_id: id(102), active: true }],
    cells,
  };
}
const config = { value_stream_bindings: [{ journey_id: id(2), scope: 'cecelia', node_key: 'product' }] };

describe('Activity 卡片列', () => {
  it('15 列里的文字/数字列来自 Activity 真身，jsonb 原样转文字，空值不编造', () => {
    const p = buildActivityCardProps({ promise: '一句承诺', inputs: [{ type: 'A' }], nfr: { a: 1 }, shelf_life_days: 7, adversarial: null }, []);
    expect(text(p['承诺'])).toBe('一句承诺');
    expect(JSON.parse(text(p['输入']))).toEqual([{ type: 'A' }]);
    expect(JSON.parse(text(p['NFR']))).toEqual({ a: 1 });
    expect(p['保质期(天)']).toEqual({ number: 7 });
    expect(p['对抗'].rich_text).toEqual([]);
    expect(buildActivityCardProps({}, [])['保质期(天)']).toEqual({ number: null });
  });

  it('8 格颜色：标准格取状态，缺格按灰；子项格（parent_cell_key 非空）不进卡片', () => {
    const p = buildActivityCardProps({}, [
      { cell_key: 'promise', cell_status: 'green' }, { cell_key: 'failure', cell_status: 'red' },
      { cell_key: 'readback', cell_status: 'pending' }, { cell_key: 'readback.network_cut', cell_status: 'red', parent_cell_key: 'readback' },
    ]);
    expect(p['格·承诺']).toEqual({ select: { name: '🟢 绿' } });
    expect(p['格·失败']).toEqual({ select: { name: '🔴 红' } });
    expect(p['格·读回']).toEqual({ select: { name: '🟡 待判' } });
    expect(p['格·NFR']).toEqual({ select: { name: '⚪ 灰' } });
    expect(Object.keys(p).filter(k => k.startsWith('格·'))).toHaveLength(8);
  });

  it('目录行带上这些列：Activity 行与 Step 行', () => {
    const rows = buildDirectoryRows(sample([{ step_id: id(6), cell_key: 'nfr', cell_status: 'green' }]), config);
    const a = rows.find(r => r.layer === 'activities');
    expect(text(a.properties['承诺'])).toBe('每轮采到新的视频');
    expect(a.properties['格·NFR']).toEqual({ select: { name: '🟢 绿' } });
    expect(a.properties['格·承诺']).toEqual({ select: { name: '⚪ 灰' } });
    const s = rows.find(r => r.layer === 'steps');
    expect(text(s.properties['动作'])).toBe('adb shell dumpsys');
    expect(text(s.properties['失败处理'])).toBe('retry:3');
    expect(s.properties['模式']).toEqual({ select: { name: 'action' } });
  });

  it('用料列：列出用到的仓库物件和角色，没有用料为空不编造', () => {
    const p = buildActivityCardProps({}, [], [{ item_name: 'CRM 表', role: 'depends' }, { item_name: '设备锁', role: 'uses' }]);
    expect(text(p['用料'])).toBe('CRM 表（depends）；设备锁（uses）');
    expect(buildActivityCardProps({}, [], [])['用料'].rich_text).toEqual([]);
  });

  it('目录行从 uses 取本 Activity 的用料', () => {
    const data = { ...sample([]), uses: [{ activity_id: id(6), item_name: '设备锁', role: 'uses' }, { activity_id: id(99), item_name: '别家', role: 'uses' }] };
    const a = buildDirectoryRows(data, config).find(r => r.layer === 'activities');
    expect(text(a.properties['用料'])).toBe('设备锁（uses）');
  });

  it('别的 Activity 的格子不会串色', () => {
    const rows = buildDirectoryRows(sample([{ step_id: id(99), cell_key: 'nfr', cell_status: 'red' }]), config);
    expect(rows.find(r => r.layer === 'activities').properties['格·NFR']).toEqual({ select: { name: '⚪ 灰' } });
  });

  it('Step 卡片：没有 on_fail 不编造；模式默认 action', () => {
    const p = buildStepCardProps({ action: null, on_fail: null, mode: null });
    expect(p['失败处理'].rich_text).toEqual([]);
    expect(p['模式']).toEqual({ select: { name: 'action' } });
  });
});

describe('目录库 schema 含新列', () => {
  const names = ['areas', 'value_streams', 'capabilities', 'workflows', 'activities', 'steps'];
  const dbs = Object.fromEntries(names.map((n, i) => [n, id(500 + i)]));
  it('Activity 库有 15 列机器列与 8 个带色选项的格子列，Step 库有三列', () => {
    const s = buildDirectorySchemas(dbs);
    for (const col of ACTIVITY_CARD_COLUMNS) expect(s.activities).toHaveProperty(col);
    for (const col of CELL_COLUMNS) {
      const opts = s.activities[col].select.options;
      expect(opts.map(o => o.name)).toEqual(['🟢 绿', '🔴 红', '🟡 待判', '⚪ 灰']);
      expect(opts.map(o => o.color)).toEqual(['green', 'red', 'yellow', 'gray']);
    }
    for (const col of ['动作', '失败处理', '模式']) expect(s.steps).toHaveProperty(col);
  });
});
