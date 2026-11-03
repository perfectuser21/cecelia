/**
 * workflow-commander-dispatch.js — Brain 主动把 workflow 派给 work-commander（任务 f38e7cc2；
 * 决策 23cc0951 Brain 选定机器·手机·账号再下派 / 3c98fb36 Commander 只照调度单起跑 / e8f872cb）。
 *
 * 为什么是新 task_type workflow_dispatch 而不是 workflow_run 加 source=brain 分支：
 *   workflow_run 是「外部起跑、Brain 只记账」的镜像——isExternalRunMirror（活性豁免）、commander-watchdog（接班）、
 *   workflow-run-lost-deadline（判 lost）都按 workflow_run 全量收；混进主动派发要在三处各开例外，漏一处就会
 *   被看门狗接班重拉 escort 或被判 lost。新类型从注册表派生自动不进镜像集合，零例外。
 *
 * 新运行：固定source/profile经公共Runner执行，Commander仅观察。以下旧协议仅用于在途只读收尾。
 * 历史流程（禁止新派发）：
 *   派发：queued 的 workflow_dispatch → 按 config/factory-workflows.json 的 commander 登记解析调度单
 *        （<能力> <机器> <profile> <serial> <biz>，缺项/非法 → failed 写缺什么，不猜）→ 发布时段外不认领 →
 *        CAS 认领 → 领 Brain 设备锁（manual-dispatch-device-gate 同一闸；被占只等不接管）→
 *        ssh MMV 起 `openclaw agent --agent work-commander`，调度单与纪律经 stdin 作为消息（不进命令行）→ in_progress
 *   收割：读 MMV ~/brain-runs/<run_id>.exit + 日志尾，取 Commander 最后输出的 `COMMANDER_RESULT {json}` →
 *        completed（带证据）/ failed（原因）→ 释放设备锁 → task_runs 补终态
 *   熟化即 workflow（任务 c0fe7e30，决策 2186700a / 26df670a）：调度单带 --run-id / --task-id；codex_agent 合同由外壳
 *        runner 落盘 ~/wf-agent-runs/<run_id>/delivery.json（系统产出），收割同一次 ssh 顺带读回 → result.delivery 供自动裁判按
 *        合同 readback 判；陪跑 skill（commander_skill 名+版本）记进 result 与 task_runs。工厂单没交付文件 → 补标明来源的失败交付。
 * us-vps 零执行：本文件只 ssh 推活与收尸，不跑推理。
 */
import { execFile as nodeExecFile } from 'node:child_process';
import { SSH_BASE_ARGS } from './ssh-args.js';
import { sshRun } from './ssh-exec.js';
import { resolvePrimaryWorkerId, sshTargetFor } from '../machine-registry.js';
import { parseReceipt, isSafeRunId } from '../openclaw-agent-executor.js';
import { resolveWorkflowConfig } from './factory-workflow-config.js';
import { withinPublishHours } from './factory-pusher.js';
import { releaseDeviceLocksHeldBy } from '../device-lock-helpers.js';
import { finalizeTask } from './task-terminal.js';
import { recordTaskEventSafe } from './task-event-log.js';
import { finishRun } from './task-run.js';

import { isLeadgenTask } from './leadgen-dispatch-contract.js';
import { dispatchLeadgenTask,reapLeadgenTask } from './leadgen-dispatch.js';
import { createWorkflowCommonAdapter } from './workflow-common-runner-adapter.js';
import { reconcileCommanderV2 } from './commander-v2-control.js';

export const WORKFLOW_DISPATCH_TASK_TYPE = 'workflow_dispatch';
export const COMMANDER_AGENT = 'work-commander';
const DEFAULT_TIMEOUT_MIN = 40;
const BATCH = 3;
const REAP_SSH_TIMEOUT_MS = 15_000;
// 调度单每一项都会被 Commander 拼进 wf-launch.sh 命令行：只许字母/数字/中文与 ._-，不许空白和引号。
const ORDER_TOKEN = /^[\p{L}\p{N}._-]+$/u;
const ARG_TOKEN = /^(--[a-z][a-z-]*|[\p{L}\p{N}._,:/=-]+)$/u;

const fail = (error) => ({ ok: false, error });

/** 按 workflow 登记解析调度单；任何缺项/非法都返回 error（不猜、不自选）。 */
export function resolveCommanderOrder(task, deps = {}) {
  const resolveConfig = deps.resolveConfig ?? ((k) => resolveWorkflowConfig(k));
  const key = task?.payload?.workflow_key;
  if (!key) return fail('payload 缺 workflow_key');
  const cfg = resolveConfig(key);
  if (!cfg) return fail(`workflow ${key} 未在 config/factory-workflows.json 登记`);
  const c = cfg.commander || {};
  const d = cfg.device || {};
  const fields = { capability: c.capability, machine: c.machine || d.ssh_host, profile: d.profile, serial: d.serial, biz: c.biz };
  const lack = Object.entries(fields).filter(([, v]) => typeof v !== 'string' || !v).map(([k]) => k);
  if (lack.length) return fail(`workflow ${key} 的 commander 调度单缺 ${lack.join('/')}`);
  const bad = Object.entries(fields).filter(([, v]) => !ORDER_TOKEN.test(v)).map(([k]) => k);
  if (bad.length) return fail(`workflow ${key} 调度单字段含非法字符：${bad.join('/')}`);
  const extra = task.payload.commander_args ?? [];
  if (!Array.isArray(extra) || extra.some((a) => typeof a !== 'string' || !ARG_TOKEN.test(a))) {
    return fail('payload.commander_args 只许旗标与无空白无引号的值');
  }
  const base = [fields.capability, fields.machine, fields.profile, fields.serial, fields.biz].join(' ');
  const order = [base, ...extra].join(' ');
  const minutes = Number(c.timeout_min) > 0 ? Number(c.timeout_min) : DEFAULT_TIMEOUT_MIN;
  return {
    ok: true, key, cfg, base, extra, order, serial: fields.serial, machine: fields.machine, timeoutSec: Math.round(minutes * 60),
    capability: fields.capability, poolKey: typeof d.pool === 'string' && d.pool ? d.pool : null,
  };
}

/**
 * 实发调度单：<五项> --run-id <run> --task-id <task> [commander_args]（任务 c0fe7e30）。
 * 外壳 runner 按 run_id 落盘 ~/wf-agent-runs/<run_id>/delivery.json，收割凭它取系统产出的交付。
 */
export function orderWithRun(r, runId, taskId) {
  return [r.base, '--run-id', runId, '--task-id', taskId, ...(r.extra || [])].join(' ');
}

/**
 * 设备池选中的那台改写调度单（派发总闸 G，任务 c5f6e683）：机器/profile/serial 取手机台账，biz 取池成员账号。
 * 任何字段不合调度单字符集 → 返回 error（不拼进 shell）。
 */
export function applyPoolMember(r, member) {
  const fields = { machine: member?.machine, profile: member?.profile, serial: member?.serial, biz: member?.account_ref };
  const bad = Object.entries(fields).filter(([, v]) => typeof v !== 'string' || !ORDER_TOKEN.test(v)).map(([k]) => k);
  if (bad.length) return fail(`设备池成员 ${member?.serial ?? '?'} 字段缺失或含非法字符：${bad.join('/')}`);
  const base = [r.capability, fields.machine, fields.profile, fields.serial, fields.biz].join(' ');
  const order = [base, ...(r.extra || [])].join(' ');
  return { ...r, base, order, serial: fields.serial, machine: fields.machine };
}

/** 给 Commander 的消息：调度单 + Brain 任务号/run_id + 纪律 + 回写约定。 */
export function buildCommanderMessage(task, r, runId) {
  const minutes = Math.round(r.timeoutSec / 60);
  return [
    `本次由 Brain 主动派发（决策 23cc0951：机器/手机/账号已由 Brain 选定）。Brain 任务 ${task.id}；run_id=${runId}；workflow=${r.key}。`,
    `调度单：${orderWithRun(r, runId, task.id)}`,
    '照做：',
    '1. 先加载 $workflow-commander，照第〇节读该 workflow 合同的 commander_skill（名+版本）自加载陪跑 skill（空则只按通用规矩），再照第二节用 wf-launch.sh 按上面调度单原样发起；不换机器、不换手机、不补参数。退出码按表处理（3=手机忙不叠跑、4=能力未部署如实报）。',
    `2. 陪跑到该 run 终态（wf-status.sh 读到 state=finished），总时限 ${minutes} 分钟内；读不到就说读不到，不编结论。`,
    '3. Brain 已代领本手机的 Brain 设备锁（owner=本任务），收尾由 Brain 释放；执行机侧手机锁由 wf-run 自己拿放。',
    '4. 最后一行只输出一行（单行 JSON，别加代码块）：',
    'COMMANDER_RESULT {"status":"completed|failed|blocked","tag":"<run TAG>","launch_exit":<wf-launch 退出码>,"evidence":["证据ID或作品页读回"],"commander_skill":{"name":"<陪跑 skill 名>","version":"<版本>"},"summary":"一句话结论"}',
    '   completed 只在 run 终态 completed 且验收读回成立时写；其余写 failed/blocked 并说明原因。commander_skill 写本次实际装上的陪跑 skill，没有写 null。',
    task.title ? `任务标题：${task.title}` : null,
    task.description ? `任务说明：${task.description}` : null,
    ...(Array.isArray(r.cfg.brief) && r.cfg.brief.length ? ['正文纪律：', ...r.cfg.brief.map((l) => `- ${l}`)] : []),
    r.cfg.acceptance ? `验收：${r.cfg.acceptance}` : null,
  ].filter(Boolean).join('\n');
}

/** 取文本里最后一个 `COMMANDER_RESULT {json}`；没有或坏 → null。 */
export function parseCommanderResult(text) {
  if (typeof text !== 'string') return null;
  const hits = [...text.matchAll(/COMMANDER_RESULT\s+(\{[^\n]*)/g)];
  if (!hits.length) return null;
  try {
    const v = JSON.parse(hits[hits.length - 1][1].trim());
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

export const DELIVERY_BEGIN = '===WFD_DELIVERY_BEGIN===';
export const DELIVERY_END = '===WFD_DELIVERY_END===';

/** 从收割输出里抽外壳 delivery.json 分隔块：{ delivery: 对象|null, rest: 剥掉分隔块后的文本 }；run_id 不符按没有。 */
export function parseDeliveryBlock(text, runId) {
  const s = typeof text === 'string' ? text : '';
  const i = s.indexOf(DELIVERY_BEGIN);
  const j = i >= 0 ? s.indexOf(DELIVERY_END, i) : -1;
  if (i < 0 || j < 0) return { delivery: null, rest: s };
  const rest = s.slice(0, i) + s.slice(j + DELIVERY_END.length).replace(/^\n/, '');
  try {
    const v = JSON.parse(s.slice(i + DELIVERY_BEGIN.length, j).trim());
    const ok = v && typeof v === 'object' && !Array.isArray(v) && v.run_id === runId;
    return { delivery: ok ? v : null, rest };
  } catch {
    return { delivery: null, rest };
  }
}

/** 工厂单没拿到外壳交付（起跑前失败 / 文件缺）：收割补一份标明来源的失败交付，让裁判能计、推进器不空转。 */
function synthesizedDelivery(runId, reason, result) {
  return {
    source: 'reaper_synthesized',
    run_id: runId,
    claimed_result: 'failed',
    lock_released: null,
    side_effects: [],
    readback: { publish_attempts: null },
    final_evidence: [],
    fail_reason: reason || `commander_${result?.status || 'unknown'}`,
    commander_skill: null,
  };
}

const defaultSshProbe = (args) => sshRun(nodeExecFile, args, { timeout: REAP_SSH_TIMEOUT_MS, encoding: 'utf8' });
const defaultReleaseLock = (taskId) => releaseDeviceLocksHeldBy(taskId);

async function failQueued(pool, id, reason, extra = {}) {
  await finalizeTask(pool, id, 'failed', {
    set: { error_message: reason },
    mergeResult: { workflow_dispatch: { reason, ...extra, at: new Date().toISOString() } },
    onlyIfStatus: ['queued', 'in_progress'],
  });
}

/** 派发一轮：返回 { dispatched, waiting, failed, skipped }。 */
export async function dispatchWorkflowCommanderTasks(pool, deps = {}) {
  const now = deps.now ?? (() => new Date());
  const roundStarted=Date.now();
  const recordEvent = deps.recordEvent ?? recordTaskEventSafe;
  const out = { dispatched: 0, waiting: 0, failed: 0, skipped: 0 };
  const { rows } = await pool.query(
    `SELECT * FROM tasks
      WHERE task_type = '${WORKFLOW_DISPATCH_TASK_TYPE}' AND status = 'queued' AND claimed_by IS NULL
      AND NOT COALESCE(payload ? 'common_runner',false)
      AND NOT EXISTS (SELECT 1 FROM workflows w WHERE w.key=tasks.payload->>'workflow_key' AND w.status='paused' AND w.key=ANY(ARRAY['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach']))
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, created_at ASC
      LIMIT ${BATCH * 10}`,
  );
  for (const t of rows ?? []) {
    if(out.dispatched>=BATCH||Date.now()-roundStarted>=45_000)break;
    if (isLeadgenTask(t)) { const state=await dispatchLeadgenTask(pool,t,deps.leadgen??{}); out[state]++; continue; }
    if(t.payload?.commander_protocol!==undefined&&t.payload.commander_protocol!=='commander-v2'){
      await failQueued(pool,t.id,'workflow_dispatch_unsupported_protocol');out.failed++;continue;
    }
    const cfg=(deps.resolveConfig??resolveWorkflowConfig)(t.payload?.workflow_key);
    if(cfg&&!withinPublishHours(now(),cfg.publish_hours)){out.skipped++;continue;}
    try{
      const result=await(deps.workflowCommonDispatch??((db,task)=>createWorkflowCommonAdapter(db,deps.workflowCommon??{}).dispatch(task.id)))(pool,t);
      if(result.dispatched)out.dispatched++;else out.waiting++;
    }catch(error){
      // 缺失正式输入/固定source不能回退到AI整块执行，也不能伪装业务已迁移成功。
      await recordEvent(pool,t.id,'workflow_common_preflight_rejected',{reason:String(error.message).slice(0,400)});out.waiting++;
    }
  }
  return out;
}

/** 收割一轮：返回 { completed, failed }。 */
export async function reapWorkflowCommanderRuns(pool, deps = {}) {
  const sshProbe = deps.sshProbe ?? defaultSshProbe;
  const releaseLock = deps.releaseLock ?? defaultReleaseLock;
  const out = { completed: 0, failed: 0 };
  const { rows } = await pool.query(
    `SELECT id, payload->>'run_id' AS run_id, payload,result FROM tasks
      WHERE task_type = '${WORKFLOW_DISPATCH_TASK_TYPE}' AND status = 'in_progress' AND (payload->>'run_id' IS NOT NULL OR result ? 'workflow_common_runner')
      ORDER BY started_at ASC NULLS FIRST LIMIT 10`,
  );
  for (const row of rows ?? []) {
    if(row.result?.workflow_common_runner){
      const result=await createWorkflowCommonAdapter(pool,deps.workflowCommon??{}).inspect(row);
      if(result.central_run?.recording_status==='confirmed'){if(result.central_run.status==='success')out.completed++;else out.failed++;}continue;
    }
    if (isLeadgenTask(row)) { const state=await reapLeadgenTask(pool,row,deps.leadgen??{}); if(state)out[state]++; continue; }
    if (row.payload?.commander_protocol === 'commander-v2') continue;
    if (!isSafeRunId(row.run_id)) continue;
    let stdout;
    try {
      const target = deps.target ?? sshTargetFor(resolvePrimaryWorkerId());
      stdout = await sshProbe([...SSH_BASE_ARGS, target,
        `if [ -f ~/brain-runs/${row.run_id}.exit ]; then echo EXIT=$(cat ~/brain-runs/${row.run_id}.exit); `
        + `if [ -f ~/wf-agent-runs/${row.run_id}/delivery.json ]; then echo '${DELIVERY_BEGIN}'; head -c 200000 ~/wf-agent-runs/${row.run_id}/delivery.json; echo; echo '${DELIVERY_END}'; fi; `
        + `tail -c 40000 ~/brain-runs/${row.run_id}.log 2>/dev/null; else echo NO_EXIT; fi`]);
    } catch (err) {
      console.warn(`[workflow-dispatch] 收割 ${row.run_id} 探测失败: ${err.message}`);
      continue;
    }
    const m = String(stdout).match(/^EXIT=(\d+)/m);
    if (!m) continue;
    const exit = parseInt(m[1], 10);
    const { delivery: shellDelivery, rest } = parseDeliveryBlock(String(stdout).replace(/^EXIT=\d+\n?/m, ''), row.run_id);
    const tail = rest;
    const receipt = parseReceipt(exit, tail);
    const result = parseCommanderResult(receipt.text) ?? parseCommanderResult(tail);
    let status = 'failed';
    let reason = null;
    if (exit !== 0) reason = `openclaw_agent_exit_${exit}`;
    else if (!result) reason = 'commander_result_missing';
    else if (result.status === 'completed') status = 'completed';
    else reason = `commander_${String(result.status || 'unknown').replace(/[^a-z_]/gi, '')}`;
    const isFactory = row.payload?.factory_dispatch === true;
    const delivery = shellDelivery ?? (isFactory ? synthesizedDelivery(row.run_id, reason, result) : null);
    const commanderSkill = result?.commander_skill ?? shellDelivery?.commander_skill ?? null;
    await finalizeTask(pool, row.id, status, {
      ...(reason ? { set: { error_message: reason } } : {}),
      mergeResult: { receipt, commander_result: result, evidence: result?.evidence ?? [], commander_skill: commanderSkill, ...(delivery ? { delivery } : {}) },
      onlyIfStatus: 'in_progress',
    });
    await releaseLock(row.id);
    await finishRun({ runId: row.run_id, status: status === 'completed' ? 'completed' : 'failed', exitCode: exit, error: reason ?? undefined, result: { commander_skill: commanderSkill } }, { pool });
    await recordTaskEventSafe(pool, row.id, 'workflow_dispatch_reaped', { run_id: row.run_id, exit, status, reason, tag: result?.tag ?? null, commander_skill: commanderSkill, delivery: shellDelivery ? 'shell' : (delivery ? 'synthesized' : 'none') });
    out[status === 'completed' ? 'completed' : 'failed']++;
  }
  return out;
}

/** scheduler job 入口：先收后派（收完放锁，同一轮就能派下一张）。 */
export async function runWorkflowCommanderDispatch(pool, deps = {}) {
  const controlled = await reconcileCommanderV2(pool, deps);
  const reaped = await reapWorkflowCommanderRuns(pool, deps);
  const dispatched = await dispatchWorkflowCommanderTasks(pool, deps);
  return { reaped, dispatched, controlled };
}
