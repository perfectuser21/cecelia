/** 英文源页复用既有任务进度与人控命令，不创建中文镜像或另一个执行入口。 */
import {syncTaskProgress} from '../projection/task-progress.js';
import {enStatusFor} from './qiumi-status-map.js';

export const resultTextOf = (result) => {
  const receipt = result?.standalone_receipt ?? result?.receipt ?? result ?? {};
  return String(receipt.finalAssistantVisibleText ?? receipt.text ?? receipt.summary ?? '').slice(0, 1900);
};

export async function pushEnglishTask(token, task, request) {
  const page = await request(token, `/pages/${task.en_page_id}`, 'GET');
  if (page.archived || page.in_trash) return 'gone';
  const current = page.properties?.Status?.status?.name;
  const status = enStatusFor(task.status, {blockedReason: task.blocked_reason});
  const previous = task.notion_props?.qiumi_pushed_en_status ?? 'Delegated';
  if (![previous, status].includes(current)) return 'human';
  const receipt = task.result?.standalone_receipt ?? task.result?.receipt ?? task.result ?? {};
  const feedback = ['queued', 'in_progress', 'blocked'].includes(task.status)
    ? task.notion_props?.qiumi_control_feedback : null;
  const foundationReason = task.result?.foundation_reconciliation ? task.error_message ?? task.blocked_detail?.reason : null;
  const summary = [resultTextOf(task.result), task.result?.standalone_receipt?.reason ?? foundationReason, feedback].filter(Boolean).join('\n');
  const evidence = Array.isArray(receipt.evidence) ? receipt.evidence.map(item => typeof item === 'string' ? item : item?.ref).filter(ref => typeof ref === 'string') : [];
  await syncTaskProgress(token, task.en_page_id, {
    title: task.title, description: task.title, status,
    result: {summary, evidence},
  }, request);
  await request(token, `/pages/${task.en_page_id}`, 'PATCH', {properties: {Status: {status: {name: status}}}});
  return 'pushed';
}

/** 只读已入账且没有中文关联的真实源页；任务身份取自Brain映射，不依赖用户添加内部列。 */
export async function readEnglishControls(pool, token, request) {
  const {rows} = await pool.query(`SELECT id, status, blocked_reason, notion_props,
      payload->>'notion_page_id' AS en_page_id FROM tasks
    WHERE task_type='qiumi_task' AND payload->>'notion_page_id' IS NOT NULL
      AND payload->>'notion_zh_page_id' IS NULL AND status IN ('queued','pending','in_progress','blocked','paused')`);
  const controls = [];
  for (const task of rows) {
    if (!task.en_page_id) continue;
    const page = await request(token, `/pages/${task.en_page_id}`, 'GET');
    const status = page.properties?.Status?.status?.name;
    if (page.archived || page.in_trash || !['Cancelled', 'Blocked'].includes(status)) continue;
    if (status === task.notion_props?.qiumi_pushed_en_status) continue;
    if (status === 'Blocked' && task.status === 'blocked') continue;
    controls.push({task, action: status === 'Cancelled' ? 'cancel' : 'hold',
      page: {id: task.en_page_id, taskNo: `brain:${task.id}`}});
  }
  return controls;
}

/** 人控命令已入现有通道后，源页显示真实状态；拒绝暂停必须有明确回执。 */
export async function acknowledgeEnglishControls(pool, token, controls, outcome, request) {
  for (const {task, action} of controls) {
    const {rows} = await pool.query('SELECT status, blocked_reason FROM tasks WHERE id=$1', [task.id]);
    if (!rows[0]) continue;
    const status = enStatusFor(rows[0].status, {blockedReason: rows[0].blocked_reason});
    const rejected = outcome.ignored.find(item => item.id === task.id && item.action === 'hold');
    const feedback = rejected ? '暂停未执行：当前任务仍在运行，请取消任务并等待原会话停止。' : null;
    await request(token, `/pages/${task.en_page_id}`, 'PATCH', {properties: {Status: {status: {name: status}}}});
    await pool.query(`UPDATE tasks SET notion_props=COALESCE(notion_props,'{}'::jsonb)
        || jsonb_build_object('qiumi_pushed_en_status',$2::text,'qiumi_control_feedback',$3::text)
        - 'qiumi_pushed_receipt' WHERE id=$1`, [task.id, status, action === 'hold' ? feedback : null]);
  }
}
