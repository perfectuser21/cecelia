/**
 * 秋米非设备任务执行体（PR3）：Brain（us-vps）经 ssh 在主力 worker 上起 `openclaw agent`。
 *
 * us-vps 只调度不执行（铁律 96054a8b / eb0a03df）——本文件里一行推理都不跑，
 * 只负责「把活 ssh 推到执行机 + 隔轮回来收尸」。
 *
 * prompt 走 stdin（远端 `M=$(cat)`），绝不拼进命令行：正文里带 token/引号/换行都不炸，
 * 也不会落进远端 ps/history。标识类字段（run_id/department/model/taskId）反过来必须
 * 过白名单正则，因为它们是要拼进远端 shell、还要当文件名用的。
 *
 * .log/.exit/.pid 三件套是与 PR1 合同 openclaw-agent 的共用约定：
 *   · probe（executor-contracts.js）读 .exit/.pid 判活
 *   · reaper（本文件）读 .exit + .log 尾巴收割成 completed_no_pr / failed
 *
 * 派发走 spawn 不走 execFile：execFile 没有 `input` 选项，stdin 既不会被写入也不会被关闭，
 * 远端 `M=$(cat)` 会一直等 EOF 等到超时——这是审查抓到的 Critical，字符串断言照不出来，
 * 只有本机真跑那条用例能照出来。收割不需要 stdin，继续用 execFile。
 *
 * SSH_BASE_ARGS 从中立叶子模块 lib/ssh-args.js 取——PR1-B 终审 I6 已把这个常量从
 * notion-push-sync.js 抽出去，那边现在只 import 不再 export，executor-contracts.js 的
 * openclaw-agent probe 也改了同一份。三个调用方同源，ssh 参数只此一份。
 */
import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import { SSH_BASE_ARGS } from './lib/ssh-args.js';
import { resolvePrimaryWorkerId, sshTargetFor } from './machine-registry.js';
import { sshWithStdin, sshRun } from './lib/ssh-exec.js';
import { recordTaskEventSafe } from './lib/task-event-log.js';
import { startRun, finishRun } from './lib/task-run.js';
import { finalizeTask } from './lib/task-terminal.js';
import { qiumiEnv, phoneNodeName } from './routing/env.js';
import { splitExecParamsBlock } from './routing/exec-params.js';
import { consumeCompanyAnalysis, markCompanyAnalysis, assertCompanyAnalysisDispatch, companyAnalysisPrompt } from './lib/company-kr-analysis.js';
import {
  parseDeviceBusyMarker, planDeviceBusy, requeueForDeviceBusy, DEVICE_BUSY_EXPIRED_REASON, DUE_AT_SELECT_SQL,
} from './lib/qiumi-device-busy.js';

// 两条白名单，宽严不同：
//  · SAFE_ID —— run_id / department / taskId。它们要当文件名用（~/brain-runs/<run_id>.log），
//    所以连 `/` 都不许有，否则能把日志写到目录外。
//  · SAFE_MODEL —— model 与 bin 路径。必须放行真实 model 串（claude-cli/claude-sonnet-5、
//    openai/gpt-5.3-codex），所以允许 `/`。
// 两条都另外拒绝 `..`：正则允许 `.` 就挡不住 `../../.ssh/x` 这类路径穿越。
const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const SAFE_MODEL = /^[A-Za-z0-9._/:-]+$/;
const OPENCLAW_BIN = '/opt/homebrew/bin/openclaw';
export const AGENT_TIMEOUT_SEC = 1800;
// 执行参数「超时」的可接受范围（1 分钟到 3 小时）；越界回落默认，不信任上游数值。
const TIMEOUT_MIN_SEC = 60;
const TIMEOUT_MAX_SEC = 10800;
// openclaw agent --thinking 的取值白名单；它要拼进远端 shell，白名单外一律拒绝。
const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max']);
const REAP_SSH_TIMEOUT_MS = 15_000;
const REAP_BATCH = 10;

/** 实际下发给 --timeout 的秒数：越界回落默认。prompt 里写的超时与命令行同一口径。 */
function effectiveTimeoutSec(timeoutSec) {
  const t = Math.round(Number(timeoutSec));
  return t >= TIMEOUT_MIN_SEC && t <= TIMEOUT_MAX_SEC ? t : AGENT_TIMEOUT_SEC;
}

function assertSafe(name, value, re) {
  const v = String(value);
  if (!re.test(v) || v.includes('..')) throw new Error(`invalid ${name}`);
}

/** run_id 既进远端 shell 也当文件名，收割侧复用同一条判据。 */
export function isSafeRunId(runId) {
  const v = String(runId);
  return SAFE_ID.test(v) && !v.includes('..');
}

/**
 * 远端一次性脚本：建目录 → 从 stdin 吸 prompt 进 $M → nohup 后台起 agent → 落三件套 → 回 DISPATCHED。
 *
 * 语句分隔用 `;` 不用 `&&`，且只有 nohup 那一段进后台——这不是风格问题，是两条 Critical：
 *  · `cmd1 && cmd2 &` 里的 `&` 套住的是整条 AND 链，而 POSIX 规定异步列表的 stdin 接
 *    /dev/null，于是 `M=$(cat)` 恒空，prompt 永远到不了 agent。
 *  · 同理 mkdir 也被甩进后台，前台的 `echo $! > ~/brain-runs/<id>.pid` 抢在目录建好之前
 *    执行，.pid 落不下来（PR1 probe 靠它判活）。
 * 现在 `mkdir` 和 `M=$(cat)` 都在前台同步做完，`{ nohup … & echo $! > … ; }` 单独成组。
 *
 * 引号层级：外层是 ssh 传过去的整串（远端登录 shell 执行）；内层 `sh -c '<inner>'` 用单引号包住，
 * 所以 inner 里的 `"$M"` 不会被外层展开，留给内层 sh 展开（M 已 export，子进程继承）。
 * 前置校验保证 inner 内不含单引号，否则会提前闭合把命令截断——这条有专门测试守着。
 *
 * `$!` 拿到的是 `sh -c` 包装进程的 pid，不是 openclaw 自己的：包装进程要等 openclaw 退出、
 * 写完 .exit 才结束，所以它在整个 agent 运行期间都活着，PR1 probe 的 `kill -0 <pid>` 判活成立。
 */
export function buildRemoteCommand({ runId, department, model = null, taskId, timeoutSec = AGENT_TIMEOUT_SEC, thinking = null, binPath = OPENCLAW_BIN }) {
  assertSafe('runId', runId, SAFE_ID);
  assertSafe('department', department, SAFE_ID);
  assertSafe('taskId', taskId, SAFE_ID);
  // 模型可选（任务 0d4215f2）：不传就不带 --model，由 OpenClaw 用该 agent 自身的默认模型。
  if (model) assertSafe('model', model, SAFE_MODEL);
  if (thinking && !THINKING_LEVELS.has(String(thinking))) throw new Error('invalid thinking');
  assertSafe('binPath', binPath, SAFE_MODEL);
  const timeout = effectiveTimeoutSec(timeoutSec);
  const modelArg = model ? ` --model ${model}` : '';
  const thinkingArg = thinking ? ` --thinking ${thinking}` : '';
  const log = `~/brain-runs/${runId}.log`;
  const exit = `~/brain-runs/${runId}.exit`;
  const pid = `~/brain-runs/${runId}.pid`;
  const inner = `${binPath} agent --agent ${department}${modelArg} --session-key agent:${department}:${runId} --message "$M" --timeout ${timeout}${thinkingArg} --json > ${log} 2>&1; echo $? > ${exit}`;
  // 幂等探针：.pid（已起）或 .exit（已跑完）在就回 ALREADY，绝不再起第二个 agent。
  // 派发侧失败会重试一次，而「ssh 超时」不等于「远端没起来」——没有这道探针，重试就会让
  // 同一个 session-key 的 agent 把同一件活跑第二遍。
  // 探针放在 `M=$(cat)` 之后：先把 stdin 读干净再决定走不走，远端提前退出会让本地写 stdin 撞 EPIPE。
  const probe = `if [ -f ${pid} ] || [ -f ${exit} ]; then echo ALREADY; exit 0; fi`;
  return `mkdir -p ~/brain-runs; M=$(cat); export M; ${probe}; { nohup sh -c '${inner}' >/dev/null 2>&1 & echo $! > ${pid}; }; echo DISPATCHED`;
}

/** 执行机 ssh 地址：机器名不写死，按注册表解析出的 primary worker 走（CI machine-registry-role-guard）。 */
function primaryTarget() {
  return sshTargetFor(resolvePrimaryWorkerId());
}

/** 目标抖音号：有 id 写「id（昵称）」，没 id 只写昵称。 */
function accountLabel(account) {
  if (!account) return null;
  const { id, nickname } = account;
  if (id && nickname) return `${id}（${nickname}）`;
  return id || nickname || null;
}

/** 手机锁被占时的约定（任务 5ad81457）：与 douyin-phone-runtime skill 同一口径，收割器按标记行回队重试。 */
const DEVICE_BUSY_RULE = '- 如手机锁被其他运行占用：不要抢锁、不要做任何操作，最后一行只输出 DEVICE_BUSY owner=<持有者> serial=<序列号> 然后结束；Brain 会自动排队重试。';

/**
 * 手机台账已定案（路由按 phone_registry 唯一命中，任务 b923b1f7）：把节点/profile/序列号/手机/目标号
 * 写死给 agent，并要求开工前核对当前登录号——0929 事故就是 agent 自己查 tsv 猜错手机。
 */
function resolvedDeviceHint(h, node) {
  const target = accountLabel(h.account);
  return [
    '设备提示（这是要碰真机的活，手机已按台账定案，按 douyin-phone-runtime skill 执行）：',
    `- 节点 ${node ?? '未知（先 openclaw nodes list 找带 PHONE 的节点）'}、profile ${h.profile}、序列号 ${h.serial}、手机 ${h.nickname}、目标抖音号 ${target ?? '未登记（以正文为准）'}`,
    '- 开工前先 account-current 核对当前登录号；与目标不符就停止并报告，不得换手机、不得切号除非正文要求',
    `- 在该节点上执行 douyin-phone-adb --profile ${h.profile} <command>，禁止裸 adb`,
    '- 先 lock-acquire <run_id>，结束必 lock-release 并回读 lock-status；每次 exec 显式 timeout 300000',
    DEVICE_BUSY_RULE,
  ].join('\n');
}

/** device_hint 给 agent 的设备提示段；is_device=true 或 Jev 含糊（verdict='ambiguous'）都要给，
 *  序列号/宿主来自路由留痕，节点名由宿主派生。 */
function deviceHintOf(task) {
  const h = task.payload?.qiumi_route?.device_hint;
  if (!h) return null;
  const ambiguous = h.is_device !== true && h.verdict === 'ambiguous';
  if (h.is_device !== true && !ambiguous) return null;
  const node = phoneNodeName(h.host, qiumiEnv());
  if (h.is_device === true && h.serial && h.nickname && h.profile) return resolvedDeviceHint(h, node);
  const headline = h.is_device === true
    ? '设备提示（这是要碰真机的活，按 douyin-phone-runtime skill 执行）：'
    : `设备提示（Jev 判断可能要碰真机 p=${h.p ?? '未知'}，先自查正文；确需碰真机则按 douyin-phone-runtime skill 执行）：`;
  return [
    headline,
    `- 手机序列号：${h.serial ?? '未定，按正文里的手机描述到 ~/.config/openclaw/douyin-phone-profiles.tsv 里查'}`,
    `- 宿主：${h.host ?? '未知'}；OpenClaw 节点：${node ?? '未知，先 openclaw nodes list 找带 PHONE 的节点'}`,
    '- 在该节点上执行 douyin-phone-adb --profile <profile> <command>（profile 按序列号在 ~/.config/openclaw/douyin-phone-profiles.tsv 查），禁止裸 adb',
    '- 先 lock-acquire <run_id>，结束必 lock-release 并回读 lock-status；每次 exec 显式 timeout 300000',
    DEVICE_BUSY_RULE,
  ].join('\n');
}

/**
 * 执行参数已应用声明（任务 e3c81cce）。0929 23:52 生产实证（任务 55c2e84b）：Brain 已按参数起了
 * `--agent media --model openai/gpt-6-sol`，prompt 里却原样留着「执行Agent：media/模型：sol」块，
 * agent 读成"要再派 media/sol 去做"→ sessions_spawn 子会话 + sessions_yield，Brain 侧 run 空报告退出，
 * 真机活在追踪外跑完。所以：参数块摘掉，改由这段说明告诉 agent「你就是它」；
 * 验收/设备不是 Brain 能"应用"的东西，原样转述给 agent，不能跟着块一起丢。
 */
function appliedParamsNotice(p) {
  const agent = p.qiumi_department;
  const model = p.model || `${agent} 默认模型`;
  const minutes = Math.round(effectiveTimeoutSec(p.timeout_sec ?? AGENT_TIMEOUT_SEC) / 60);
  const requestedDevice = p.qiumi_route?.device_hint?.requested ?? null;
  return [
    `执行参数已由 Brain 应用：你就是 ${agent}，本次模型 ${model}，超时 ${minutes} 分钟。直接在本会话完成任务，不要 sessions_spawn 子会话，不要 sessions_yield 等待。`,
    p.acceptance ? `验收：${p.acceptance}` : null,
    requestedDevice ? `设备：${requestedDevice}` : null,
  ].filter(Boolean).join('\n');
}

function promptOf(task) {
  const p = task.payload ?? {};
  const s = p.qiumi_source ?? {};
  const sourceBody = p.company_kr_analysis?.version === 1 ? companyAnalysisPrompt(p.company_kr_analysis) : s.body;
  // 能走到派发，就说明路由已按参数块定案（块解析出错会在路由层直接 fail，到不了这里）
  const block = sourceBody ? splitExecParamsBlock(sourceBody) : { present: false, rest: sourceBody };
  const applied = block.present && Boolean(p.qiumi_department);
  const body = applied ? block.rest : sourceBody;
  return [
    applied ? appliedParamsNotice(p) : null,
    s.title,
    s.remark ? `补充说明：${s.remark}` : null,
    body ? `页面正文：\n${body}` : null,
    deviceHintOf(task),
  ].filter(Boolean).join('\n\n');
}

/**
 * 派发一条秋米任务到执行机。
 *
 * status 迁移带 `AND status IN ('queued', 'in_progress')` 的 CAS，两种入口都成立：
 * dispatcher 主流程调进来时任务已被它标成 in_progress（此处只补 started_at，幂等）；
 * 直派入口调进来时任务仍是 queued。落在这两个之外的状态（别的通道已经结过账、
 * 或任务被取消）一律不动——不把已完结的任务拽回 in_progress。
 */
export async function triggerOpenclawAgent(task, deps = {}) {
  const spawnFn = deps.spawnFn ?? nodeSpawn;
  const pool = deps.pool ?? (await import('./db.js')).default;
  const runId = task.payload?.run_id;
  const model = task.payload?.model;
  const department = task.payload?.qiumi_department;
  if (!runId || !department) {
    return { success: false, taskId: task.id, reason: 'openclaw_agent_spawn_failed', error: 'missing run_id/department' };
  }
  if (task.payload?.company_kr_analysis?.version === 1) {
    try { await assertCompanyAnalysisDispatch(pool, task); }
    catch (error) {
      if (error.code !== 'company_kr_analysis_superseded') return { success: false, taskId: task.id, reason: 'openclaw_agent_spawn_failed', error: error.message };
      await finalizeTask(pool, task.id, 'failed', { set: { error_message: 'company_kr_analysis_superseded' },
        mergeResult: { company_analysis_rejected: { actor: 'brain', fact: error.message, at: new Date().toISOString() } }, onlyIfStatus: ['queued', 'in_progress'] });
      await markCompanyAnalysis(pool, task, 'failed', error.message);
      return { success: false, taskId: task.id, reason: 'company_kr_analysis_superseded', error: error.message, taskTerminal: true };
    }
  }

  let remote;
  let target;
  let machine;
  try {
    remote = buildRemoteCommand({
      runId, department, model, taskId: task.id,
      timeoutSec: task.payload?.timeout_sec ?? AGENT_TIMEOUT_SEC,
      thinking: task.payload?.thinking ?? null,
    });
    machine = resolvePrimaryWorkerId();
    target = primaryTarget();
  } catch (err) {
    return { success: false, taskId: task.id, reason: 'openclaw_agent_spawn_failed', error: err.message };
  }

  // spec 第 3 节：ssh 派发失败重试一次再判死。重试是安全的——远端命令自带 ALREADY 探针
  // （buildRemoteCommand），第一次其实起来了的话第二次只会回 ALREADY，不会跑第二遍。
  const attempt = async () => {
    const out = await sshWithStdin(spawnFn, [...SSH_BASE_ARGS, target, remote], promptOf(task));
    if (/ALREADY/.test(out)) return 'already';
    if (!/DISPATCHED/.test(out)) throw new Error(`no DISPATCHED marker: ${out.slice(0, 120)}`);
    return 'dispatched';
  };

  let spawnOutcome;
  try {
    spawnOutcome = await attempt();
  } catch (first) {
    console.warn(`[openclaw-agent] 派发失败，重试一次 (task=${task.id}): ${first.message}`);
    try {
      spawnOutcome = await attempt();
    } catch (second) {
      return {
        success: false,
        taskId: task.id,
        reason: 'openclaw_agent_spawn_failed',
        error: `${first.message} | 重试: ${second.message}`,
      };
    }
  }

  await pool.query(
    `UPDATE tasks SET executor_kind = 'openclaw-agent', updated_at = NOW() WHERE id = $1`,
    [task.id],
  );
  await pool.query(
    `UPDATE tasks SET status = 'in_progress', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
      WHERE id = $1 AND status IN ('queued', 'in_progress')`,
    [task.id],
  );
  await recordTaskEventSafe(pool, task.id, 'openclaw_agent_spawned', {
    run_id: runId, department, model, machine, already_running: spawnOutcome === 'already',
  });
  // 一次执行 = 一行 task_runs（run 原语，fail-open）：ssh 已把 agent 起到执行机，此刻起算开始。
  await startRun({
    taskId: task.id,
    runId,
    source: 'openclaw-agent',
    context: { department, model, machine, already_running: spawnOutcome === 'already' },
  }, { pool });
  return { success: true, taskId: task.id, runId, executor: 'openclaw-agent' };
}

/**
 * 回执：退出码 + agent 末段 JSON 里的可见结论（拿不到就留 null，log 尾巴照样存）。
 *
 * `--json` 输出是多行的，最后一行才是总结；正文里也常有带大括号的文字。所以从末尾逐行往上找
 * 第一行「以 { 开头且整行能 JSON.parse」的——按整块尾巴去匹配大括号会被正文里的括号骗走。
 */
function parseReceipt(exit, tail) {
  let text = null;
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // 这行不是完整 JSON（正文带括号、或被 tail -c 切断），继续往上找
    }
    text = parsed.finalAssistantVisibleText ?? parsed?.result?.payloads?.[0]?.text ?? null;
    break;
  }
  // 真实 --json 输出是多行缩进 JSON，且尾巴常从对象中间截断，上面逐行解析取不到：
  // 直接按字段名取最后一个 finalAssistantVisibleText 的字符串值（JSON 字符串转义照常解码）。
  if (text == null) {
    const all = [...tail.matchAll(/"finalAssistantVisibleText":\s*"((?:[^"\\]|\\.)*)"/g)];
    if (all.length) {
      try { text = JSON.parse(`"${all[all.length - 1][1]}"`); } catch { text = null; }
    }
  }
  if (text == null) {
    // OpenClaw当前CLI也输出多行result.payloads；从行首对象尝试完整包装。
    const starts = [...tail.matchAll(/^[ \t]*\{/gm)].map(m => m.index).slice(-100);
    for (const start of starts) {
      try {
        const parsed = JSON.parse(tail.slice(start).trim());
        const visible = parsed.finalAssistantVisibleText ?? parsed?.result?.payloads?.[0]?.text;
        if (typeof visible === 'string') { text = visible; break; }
      } catch { /* 非完整CLI包装，继续寻找。 */ }
    }
  }
  return { exit, text, log_tail: tail.slice(-2000), reaped_at: new Date().toISOString() };
}

/**
 * agent 以 sessions_yield 收尾、没有交最终结果（任务 e3c81cce）。55c2e84b 真实 .log：开头
 * `result.payloads: []`，尾部 `meta.yielded: true` + `acceptedSessionSpawns[]`；收割只读 tail -c 20000，
 * 30KB 的日志开头读不到，所以两类信号任一命中即算：
 *  · `"yielded": true` —— 本会话暂停等子会话，活在追踪外，有没有过渡文本都不算完成；
 *  · 没有最终文本且 `"payloads": []` —— 什么都没交。
 * 仅「无最终文本」不单独判失败：旧格式纯文本日志也取不到 text，那不是 yield。
 */
function yieldSummaryOf(tail, text) {
  const yielded = /"yielded"\s*:\s*true/.test(tail);
  const emptyPayloads = text == null && /"payloads"\s*:\s*\[\s*\]/.test(tail);
  if (!yielded && !emptyPayloads) return null;
  const childSessions = [...tail.matchAll(/"childSessionKey"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  return { yielded, empty_payloads: emptyPayloads, has_text: text != null, child_sessions: childSessions };
}

/** 回执 → 终态：退出码非 0 → exit_<n>；exit 0 但以 yield 收尾 → agent_yielded_without_result；否则完成。 */
function reapOutcome(receipt, tail) {
  if (receipt.exit !== 0) return { status: 'failed', reason: `openclaw_agent_exit_${receipt.exit}`, yieldSummary: null };
  const yieldSummary = yieldSummaryOf(tail, receipt.text);
  if (yieldSummary) return { status: 'failed', reason: 'agent_yielded_without_result', yieldSummary };
  return { status: 'completed_no_pr', reason: null, yieldSummary: null };
}

/**
 * agent 回报手机忙（最终文本含 DEVICE_BUSY 标记行，任务 5ad81457）→ 不判终态，回队等 5 分钟再派；
 * 到截止时间（expires_at → due_at → 首次忙起 24 小时）仍忙 → failed(device_busy_expired)。
 * 排队不占执行超时：timeout_sec 只作用于真正运行的那次 run（triggerOpenclawAgent 的 --timeout）。
 * @returns {Promise<'requeued'|'failed'|null>} null = 不是手机忙，走常规收割
 */
async function settleDeviceBusy(pool, row, receipt, now) {
  const marker = parseDeviceBusyMarker(receipt.text);
  if (!marker) return null;
  const payload = row.payload ?? {};
  const plan = planDeviceBusy({ payload, marker, dueAt: row.due_at ?? null, now });
  if (plan.action === 'requeue') {
    const requeued = await requeueForDeviceBusy(pool, row.id, plan, row.run_id);
    await finishRun({ runId: row.run_id, status: 'cancelled', exitCode: receipt.exit, error: 'device_busy' }, { pool });
    await recordTaskEventSafe(pool, row.id, 'qiumi_device_busy_requeued', {
      run_id: row.run_id, owner: plan.deviceBusy.owner, serial: plan.deviceBusy.serial,
      attempt: plan.attempts, next_run_at: plan.nextRunAt, waited_ms: plan.waitedMs,
      deadline_at: plan.deadlineAt, deadline_source: plan.deadlineSource, applied: requeued,
    });
    return 'requeued';
  }
  await finalizeTask(pool, row.id, 'failed', {
    set: { error_message: DEVICE_BUSY_EXPIRED_REASON },
    mergeResult: { receipt, device_busy: plan.deviceBusy },
    onlyIfStatus: 'in_progress',
  });
  await finishRun({ runId: row.run_id, status: 'failed', exitCode: receipt.exit, error: DEVICE_BUSY_EXPIRED_REASON }, { pool });
  await recordTaskEventSafe(pool, row.id, 'openclaw_agent_reaped', {
    run_id: row.run_id, exit: receipt.exit, reason: DEVICE_BUSY_EXPIRED_REASON,
    owner: plan.deviceBusy.owner, attempt: plan.attempts, waited_ms: plan.waitedMs,
    deadline_at: plan.deadlineAt, deadline_source: plan.deadlineSource,
  });
  return 'failed';
}

/**
 * 收割在跑的 openclaw-agent 任务：远端 .exit 落地即结算。
 *
 * 三态：EXIT=0 → completed_no_pr + receipt（以 yield 收尾的除外 → failed + agent_yielded_without_result，
 * 不自动重排：子会话可能已在真机上动手，重跑会把真机操作做两遍）；EXIT≠0 → failed + openclaw_agent_exit_<n>；
 * NO_EXIT → 一律不动（还在跑），超时交给合同 staleMinutes=45 + 守护刀 onStale='fail'。
 * 例外：最终文本含 DEVICE_BUSY 标记行（手机锁被占）→ 先于三态处理，回队等待（settleDeviceBusy）。
 * 两条 UPDATE 都带 `AND status = 'in_progress'` 的 CAS：不覆盖别的通道已经结过的账。
 *
 * 取数 LIMIT 10 且单条 ssh 15s：最坏 10×15s=150s，压在 scheduler job 的 300s 超时里。
 * ORDER BY started_at ASC NULLS FIRST —— 老任务先收，积压时不会有任务被一直挤在队尾饿死。
 */
export async function reapOpenclawAgentRuns(pool, deps = {}) {
  const execFileFn = deps.execFileFn ?? nodeExecFile;
  const now = deps.now ?? Date.now;
  const { rows } = await pool.query(
    `SELECT id, payload->>'run_id' AS run_id, payload, ${DUE_AT_SELECT_SQL} AS due_at FROM tasks
      WHERE task_type = 'qiumi_task' AND status = 'in_progress' AND executor_kind = 'openclaw-agent'
        AND payload->>'run_id' IS NOT NULL
      ORDER BY started_at ASC NULLS FIRST
      LIMIT ${REAP_BATCH}`,
  );
  const out = { reaped: 0, completed: 0, failed: 0, requeued: 0 };
  for (const r of rows ?? []) {
    const companyAnalysis = r.payload?.company_kr_analysis?.version === 1;
    if (!isSafeRunId(r.run_id)) {
      console.warn(`[openclaw-agent] 收割跳过非法 run_id: ${String(r.run_id).slice(0, 60)}`);
      continue;
    }
    let stdout;
    try {
      stdout = await sshRun(execFileFn, [
        ...SSH_BASE_ARGS, primaryTarget(),
        `if [ -f ~/brain-runs/${r.run_id}.exit ]; then echo EXIT=$(cat ~/brain-runs/${r.run_id}.exit); tail -c ${companyAnalysis ? 160000 : 20000} ~/brain-runs/${r.run_id}.log 2>/dev/null; else echo NO_EXIT; fi`,
      ], { timeout: REAP_SSH_TIMEOUT_MS, encoding: 'utf8' });
    } catch (err) {
      console.warn(`[openclaw-agent] 收割 ${r.run_id} 探测失败: ${err.message}`);
      continue;
    }
    const m = stdout.match(/^EXIT=(\d+)/m);
    if (!m) continue;
    const exit = parseInt(m[1], 10);
    const tail = stdout.replace(/^EXIT=\d+\n?/m, '');
    const receipt = parseReceipt(exit, tail);
    const busy = await settleDeviceBusy(pool, r, receipt, now());
    if (busy === 'requeued') { out.requeued++; continue; }
    if (busy === 'failed') { out.failed++; out.reaped++; continue; }
    let outcome = reapOutcome(receipt, tail);
    let analysis = null;
    if (companyAnalysis && outcome.status === 'completed_no_pr') {
      try { analysis = await (deps.consumeCompanyAnalysis || consumeCompanyAnalysis)(pool, r, receipt); }
      catch (error) { outcome = { status: 'failed', reason: `company_kr_analysis_rejected: ${error.message}`, yieldSummary: null }; }
    }
    if (companyAnalysis && outcome.status === 'failed') await (deps.markCompanyAnalysis || markCompanyAnalysis)(pool, r, 'failed', outcome.reason);
    if (outcome.status === 'completed_no_pr') {
      // completed_no_pr 是可接棒终态（RELAY_TERMINAL_STATUSES）：finalizeTask 写完自动接棒
      await finalizeTask(pool, r.id, 'completed_no_pr', { mergeResult: { receipt, ...(analysis ? { company_kr_analysis: analysis } : {}) }, onlyIfStatus: 'in_progress' });
      out.completed++;
    } else {
      const mergeResult = outcome.yieldSummary ? { receipt, yield_summary: outcome.yieldSummary } : { receipt };
      await finalizeTask(pool, r.id, 'failed', {
        set: { error_message: outcome.reason },
        mergeResult,
        onlyIfStatus: 'in_progress',
      });
      out.failed++;
    }
    out.reaped++;
    // run 原语补终态：exit≠0 或以 yield 收尾 → failed，其余 → completed，已终态不覆盖。
    await finishRun({
      runId: r.run_id,
      status: outcome.status === 'completed_no_pr' ? 'completed' : 'failed',
      exitCode: exit,
      error: outcome.reason ?? undefined,
    }, { pool });
    await recordTaskEventSafe(pool, r.id, 'openclaw_agent_reaped', {
      run_id: r.run_id, exit, ...(outcome.reason ? { reason: outcome.reason } : {}),
    });
  }
  return out;
}
