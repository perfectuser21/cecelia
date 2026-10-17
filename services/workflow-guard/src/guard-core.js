// write-guard 核心校验：决定 worker 这次写产物是否被授权，授权则发 fence_token。
//
// 为什么存在：workflow 的写入契约要求 worker 每次写产物前先拿栅栏令牌，用来挡住
// "慢的旧重试晚返回、覆盖新结果" 这类事故（AGENTS.md：禁止晚返回覆盖新结果）。
//
// 为什么要抽出来：原实现是一个 CLI 脚本，Commander 把**它自己容器里的绝对路径**发给
// worker 让其本地执行。但 worker 实际跑在 XIAN-M4-PHONE（Mac），Commander 账本在 hk-vps
// 容器里——脚本和账本都不在 worker 那侧。2026-09-07 final6 因此四次重试全挂在
// "guard path was unavailable in the worker environment"，而视频其实已经找到了
// （found one valid candidate and exhaustion evidence），纯粹卡在交不了作业。
//
// 校验必须读 Commander 账本，所以只能在账本所在主机执行。核心抽到这里后由 CLI 与 HTTP
// 服务共用同一份——一份逻辑两处用，避免两套实现漂移出不一致的授权结果。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_STATE_DIR = '/root/clawd-work-commander/state/workflow-runs';

/** 哪种写意图允许出现在哪些阶段。改这张表等于改权限模型。 */
export const WRITE_INTENTS = {
  artifact_write: new Set(['preflight', 'discovery', 'qualification', 'collection', 'scoring', 'delivery', 'outreach', 'cleanup', 'plan', 'contract', 'seal', 'generate', 'evaluate', 'judge', 'publish', 'merge']),
  raw_comment_insert: new Set(['collection']),
  raw_comment_update: new Set(['scoring', 'delivery']),
  final_lead_write: new Set(['delivery', 'outreach']),
  keyword_cursor_write: new Set(['delivery']),
  outreach_claim_write: new Set(['outreach']),
  outreach_account_update: new Set(['outreach']),
};

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

const deny = (error, details = {}) => ({ ok: false, authorized: false, error, ...details });

function transitionEvents(state) {
  const transitions = new Set(['stage_started', 'stage_accepted', 'retrying', 'blocked']);
  return (state.events || [])
    .map((entry) => entry?.payload || entry)
    .filter((payload) => payload && transitions.has(payload.event));
}

/**
 * 判定并签发写入授权。**不抛异常**——所有失败都返回 {ok:false, error}，
 * 因为调用方既有 CLI（要转成退出码）也有 HTTP（要转成状态码）。
 * @returns {{ok:boolean, authorized:boolean, fence_token?:string, error?:string}}
 */
export function authorizeWrite(input = {}, deps = {}) {
  const readFile = deps.readFile || ((f) => fs.readFileSync(f, 'utf8'));

  const fields = {
    run_id: input.run_id, attempt_id: input.attempt_id, execution_id: input.execution_id,
    lease_id: input.lease_id, worker_agent_id: input.worker_agent_id,
    stage_id: input.stage_id, intent: input.intent,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === '' || value === null) return deny(`Missing ${key}`);
    // id 白名单同时挡住路径穿越——run_id 会被拼进账本文件名
    if (!ID_RE.test(String(value))) return deny(`Invalid ${key}`);
  }

  const stageAttempt = Number(input.stage_attempt);
  if (!Number.isInteger(stageAttempt) || stageAttempt < 1) return deny('Invalid stage_attempt');
  if (!WRITE_INTENTS[input.intent]) return deny('Unknown write intent', { intent: input.intent });
  if (!WRITE_INTENTS[input.intent].has(input.stage_id)) {
    return deny('Write intent is not allowed for this stage', { intent: input.intent, stage_id: input.stage_id });
  }

  const stateDir = path.resolve(String(input.state_dir || DEFAULT_STATE_DIR));
  const stateFile = path.join(stateDir, `${input.run_id}__${input.attempt_id}.json`);
  let state;
  try {
    state = JSON.parse(readFile(stateFile));
  } catch (error) {
    return deny('Cannot read Commander ledger', { state_file: stateFile, cause: error.message });
  }

  const expectedExecutionId = `${input.run_id}:${input.attempt_id}`;
  if (input.execution_id !== expectedExecutionId || state.execution_id !== input.execution_id) {
    return deny('Execution identity mismatch', {
      execution_id: input.execution_id, ledger_execution_id: state.execution_id,
    });
  }
  if (state.run_id !== input.run_id || state.attempt_id !== input.attempt_id) return deny('Run identity mismatch');
  if (state.worker_agent_id !== input.worker_agent_id) {
    return deny('Worker agent mismatch', {
      worker_agent_id: input.worker_agent_id, ledger_worker_agent_id: state.worker_agent_id,
    });
  }
  // lease_id 是 Commander 为本次 run 签发的、只有当班 worker 知道的通行证。
  // 远程化后它同时承担"调用方是不是这次的 worker"这层鉴权。
  if (state.lease_id !== input.lease_id) return deny('Commander lease mismatch');
  if (state.terminal) return deny('Execution is terminal and immutable', { terminal_status: state.terminal.status });
  if (state.pending_relay) return deny('Commander event relay is pending; writes are fenced until event state is durable');

  const active = transitionEvents(state).at(-1);
  if (!active || active.event !== 'stage_started') {
    return deny('No writable stage is active', { latest_transition: active?.event || null });
  }
  if (active.stage_id !== input.stage_id || Number(active.stage_attempt) !== stageAttempt) {
    return deny('Stale or out-of-order worker attempt', {
      requested_stage: input.stage_id, requested_stage_attempt: stageAttempt,
      active_stage: active.stage_id, active_stage_attempt: active.stage_attempt,
      active_event_id: active.event_id,
    });
  }

  const tokenSource = [
    input.execution_id, input.lease_id, input.worker_agent_id,
    input.stage_id, stageAttempt, input.intent, active.event_id,
  ].join('|');

  return {
    ok: true,
    authorized: true,
    schema_version: 2,
    run_id: input.run_id,
    attempt_id: input.attempt_id,
    execution_id: input.execution_id,
    worker_agent_id: input.worker_agent_id,
    stage_id: input.stage_id,
    stage_attempt: stageAttempt,
    intent: input.intent,
    commander_event_id: active.event_id,
    fence_token: crypto.createHash('sha256').update(tokenSource).digest('hex'),
    state_file: stateFile,
  };
}
