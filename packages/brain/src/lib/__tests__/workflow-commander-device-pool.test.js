/**
 * 抖音发布 workflow（Brain→Commander 出口）从设备池选机（派发总闸 G，任务 c5f6e683）。
 * 登记了 device.pool 的 workflow：认领后从池里按 priority 试锁，选中哪台调度单就写哪台；
 * 全被占只等不接管；池空 → failed 写原因。派发成功后落 Brain 租约（超时 + 15 分钟）。
 */
import { describe, it, expect, vi } from 'vitest';
import { WORKFLOW_DISPATCH_TASK_TYPE, dispatchWorkflowCommanderTasks,resolveCommanderOrder,applyPoolMember } from '../workflow-commander-dispatch.js';
import { resolveWorkflowConfig } from '../factory-workflow-config.js';

const CFG = {
  workflow_key: 'douyin_video_publish.android',
  device: { node: 'XIAN-M4-PHONE', profile: 'xiaolongxia', serial: 'ANGYVB4311010223', ssh_host: 'xian-m4', pool: 'douyin.internal' },
  commander: { capability: 'douyin_video_publish', biz: 'Ai办公室', timeout_min: 40 },
  publish_hours: [9, 23],
};
const resolveConfig = (k) => (k === CFG.workflow_key ? CFG : null);
const IN_HOURS = () => new Date('2026-10-12T02:00:00Z');
const T = {
  id: 'bbbbbbbb-1111-2222-3333-444444444444', task_type: WORKFLOW_DISPATCH_TASK_TYPE, status: 'queued',
  title: '发一条抖音私密作品', priority: 'P1', payload: { workflow_key: CFG.workflow_key },
};
function fakePool() {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      if (/FROM tasks[\s\S]*status = 'queued'/.test(sql)) return { rows: [T] };
      if (/UPDATE tasks SET claimed_by = \$2/.test(sql)) return { rows: [T], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }),
  };
}
const SECOND = { serial: 'e6c7ef34', machine: 'xian-m4', profile: 'yueshengyun-work', account_ref: 'Ai效率笔记', priority: 20 };

describe('真配置', () => {
  it('抖音·视频发布登记了 device.pool=douyin.internal', () => {
    expect(resolveWorkflowConfig('douyin_video_publish.android').device.pool).toBe('douyin.internal');
  });
});

describe('固定发布source与历史设备池边界',()=>{
 it('新运行由固定发布profile选择资源，不能用旧设备池改写账号',async()=>{
  const pool=fakePool(),selectFromPool=vi.fn(async()=>({ok:true,member:SECOND})),common=vi.fn(async()=>({dispatched:true})),sshDispatch=vi.fn();
  const out=await dispatchWorkflowCommanderTasks(pool,{resolveConfig,now:IN_HOURS,selectFromPool,workflowCommonDispatch:common,sshDispatch});
  expect(out.dispatched).toBe(1);expect(common).toHaveBeenCalledWith(pool,T);expect(selectFromPool).not.toHaveBeenCalled();expect(sshDispatch).not.toHaveBeenCalled();
 });
 it.each(['all_busy','pool_empty'])('旧设备池%s不能绕过固定source的代码资源闸',async reason=>{
  const pool=fakePool(),sshDispatch=vi.fn(),releaseLock=vi.fn();
  const out=await dispatchWorkflowCommanderTasks(pool,{resolveConfig,now:IN_HOURS,workflowCommonDispatch:async()=>({waiting:true,reason}),sshDispatch,releaseLock});
  expect(out.waiting).toBe(1);expect(sshDispatch).not.toHaveBeenCalled();expect(releaseLock).not.toHaveBeenCalled();
 });
 it('历史调度单解析仍拒绝非法成员字符，仅供在途诊断',()=>{
  const order=resolveCommanderOrder(T,{resolveConfig});expect(applyPoolMember(order,{...SECOND,account_ref:'a b'}).ok).toBe(false);
 });
 it('历史成员映射仍保留完整身份，不能只替换serial',()=>{
  const order=resolveCommanderOrder(T,{resolveConfig}),selected=applyPoolMember(order,SECOND);
  expect(selected.serial).toBe(SECOND.serial);expect(selected.order).toContain('yueshengyun-work e6c7ef34 Ai效率笔记');
 });
});
