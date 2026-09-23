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
import { recordTaskEventSafe } from './lib/task-event-log.js';
import { qiumiEnv, phoneNodeName } from './routing/env.js';

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
const SPAWN_TIMEOUT_MS = 30_000;
const REAP_SSH_TIMEOUT_MS = 15_000;
const REAP_BATCH = 10;

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
export function buildRemoteCommand({ runId, department, model, taskId, timeoutSec = AGENT_TIMEOUT_SEC, binPath = OPENCLAW_BIN }) {
  assertSafe('runId', runId, SAFE_ID);
  assertSafe('department', department, SAFE_ID);
  assertSafe('taskId', taskId, SAFE_ID);
  assertSafe('model', model, SAFE_MODEL);
  assertSafe('binPath', binPath, SAFE_MODEL);
  const log = `~/brain-runs/${runId}.log`;
  const exit = `~/brain-runs/${runId}.exit`;
  const pid = `~/brain-runs/${runId}.pid`;
  const inner = `${binPath} agent --agent ${department} --model ${model} --session-key agent:${department}:qiumi-${taskId} --message "$M" --timeout ${timeoutSec} --json > ${log} 2>&1; echo $? > ${exit}`;
  // 幂等探针：.pid（已起）或 .exit（已跑完）在就回 ALREADY，绝不再起第二个 agent。
  // 派发侧失败会重试一次，而「ssh 超时」不等于「远端没起来」——没有这道探针，重试就会让
  // 同一个 session-key 的 agent 把同一件活跑第二遍。
  // 探针放在 `M=$(cat)` 之后：先把 stdin 读干净再决定走不走，远端提前退出会让本地写 stdin 撞 EPIPE。
  const probe = `if [ -f ${pid} ] || [ -f ${exit} ]; then echo ALREADY; exit 0; fi`;
  return `mkdir -p ~/brain-runs; M=$(cat); export M; ${probe}; { nohup sh -c '${inner}' >/dev/null 2>&1 & echo $! > ${pid}; }; echo DISPATCHED`;
}

/**
 * 起一个 ssh 子进程，把 prompt 从 stdin 灌进去并关闭，收齐 stdout 后返回。
 * 超时自己管：kill 子进程并 reject，绝不让一条卡住的 ssh 挂死整轮派发。
 */
function sshWithStdin(spawnFn, args, input, timeoutMs = SPAWN_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 已经退了就算了 */ }
      finish(reject, new Error(`ssh timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (d) => { stdout += String(d); });
    child.stderr?.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => finish(reject, err));
    child.on('close', (code) => {
      if (code === 0) finish(resolve, stdout);
      else finish(reject, Object.assign(new Error(`ssh exit ${code}: ${stderr.slice(0, 200)}`), { stderr }));
    });
    // 必须 end 而不是 write：远端 `M=$(cat)` 要等 EOF 才往下走。
    child.stdin?.end(input ?? '');
  });
}

/** 收割侧的 ssh：不需要 stdin，用 execFile 就够。 */
function sshRun(execFileFn, args, opts) {
  return new Promise((resolve, reject) => {
    execFileFn('ssh', args, opts, (err, stdout, stderr) => (
      err ? reject(Object.assign(err, { stderr })) : resolve(String(stdout))
    ));
  });
}

/** 执行机 ssh 地址：机器名不写死，按注册表解析出的 primary worker 走（CI machine-registry-role-guard）。 */
function primaryTarget() {
  return sshTargetFor(resolvePrimaryWorkerId());
}

/** device_hint.is_device 时给 agent 的设备提示段；序列号/宿主来自路由留痕，节点名由宿主派生。 */
function deviceHintOf(task) {
  const h = task.payload?.qiumi_route?.device_hint;
  if (!h || h.is_device !== true) return null;
  const node = phoneNodeName(h.host, qiumiEnv());
  return [
    '设备提示（这是要碰真机的活，按 douyin-phone-runtime skill 执行）：',
    `- 手机序列号：${h.serial ?? '未定，按正文里的手机描述到节点的 douyin-phone-profiles.tsv 里查'}`,
    `- 宿主：${h.host ?? '未知'}；OpenClaw 节点：${node ?? '未知，先 openclaw nodes list 找带 PHONE 的节点'}`,
    '- 在该节点上执行 douyin-phone-adb --profile <profile> <command>（profile 按序列号在节点的 registry 查），禁止裸 adb',
    '- 先 lock-acquire <run_id>，结束必 lock-release 并回读 lock-status；每次 exec 显式 timeout 300000',
  ].join('\n');
}

function promptOf(task) {
  const s = task.payload?.qiumi_source ?? {};
  return [
    s.title,
    s.remark ? `补充说明：${s.remark}` : null,
    s.body ? `页面正文：\n${s.body}` : null,
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
  if (!runId || !model || !department) {
    return { success: false, taskId: task.id, reason: 'openclaw_agent_spawn_failed', error: 'missing run_id/model/department' };
  }

  let remote;
  let target;
  let machine;
  try {
    remote = buildRemoteCommand({ runId, department, model, taskId: task.id });
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
  return { exit, text, log_tail: tail.slice(-2000), reaped_at: new Date().toISOString() };
}

/**
 * 收割在跑的 openclaw-agent 任务：远端 .exit 落地即结算。
 *
 * 三态：EXIT=0 → completed_no_pr + receipt；EXIT≠0 → failed + openclaw_agent_exit_<n>；
 * NO_EXIT → 一律不动（还在跑），超时交给合同 staleMinutes=45 + 守护刀 onStale='fail'。
 * 两条 UPDATE 都带 `AND status = 'in_progress'` 的 CAS：不覆盖别的通道已经结过的账。
 *
 * 取数 LIMIT 10 且单条 ssh 15s：最坏 10×15s=150s，压在 scheduler job 的 300s 超时里。
 * ORDER BY started_at ASC NULLS FIRST —— 老任务先收，积压时不会有任务被一直挤在队尾饿死。
 */
export async function reapOpenclawAgentRuns(pool, deps = {}) {
  const execFileFn = deps.execFileFn ?? nodeExecFile;
  const { rows } = await pool.query(
    `SELECT id, payload->>'run_id' AS run_id FROM tasks
      WHERE task_type = 'qiumi_task' AND status = 'in_progress' AND executor_kind = 'openclaw-agent'
        AND payload->>'run_id' IS NOT NULL
      ORDER BY started_at ASC NULLS FIRST
      LIMIT ${REAP_BATCH}`,
  );
  const out = { reaped: 0, completed: 0, failed: 0 };
  for (const r of rows ?? []) {
    if (!isSafeRunId(r.run_id)) {
      console.warn(`[openclaw-agent] 收割跳过非法 run_id: ${String(r.run_id).slice(0, 60)}`);
      continue;
    }
    let stdout;
    try {
      stdout = await sshRun(execFileFn, [
        ...SSH_BASE_ARGS, primaryTarget(),
        `if [ -f ~/brain-runs/${r.run_id}.exit ]; then echo EXIT=$(cat ~/brain-runs/${r.run_id}.exit); tail -c 4000 ~/brain-runs/${r.run_id}.log 2>/dev/null; else echo NO_EXIT; fi`,
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
    if (exit === 0) {
      await pool.query(
        `UPDATE tasks SET status = 'completed_no_pr', completed_at = COALESCE(completed_at, NOW()),
                claimed_by = NULL, claimed_at = NULL,
                result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('receipt', $2::jsonb), updated_at = NOW()
          WHERE id = $1 AND status = 'in_progress'`,
        [r.id, JSON.stringify(receipt)],
      );
      out.completed++;
    } else {
      await pool.query(
        `UPDATE tasks SET status = 'failed', error_message = $2, claimed_by = NULL, claimed_at = NULL,
                result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('receipt', $3::jsonb), updated_at = NOW()
          WHERE id = $1 AND status = 'in_progress'`,
        [r.id, `openclaw_agent_exit_${exit}`, JSON.stringify(receipt)],
      );
      out.failed++;
    }
    out.reaped++;
    await recordTaskEventSafe(pool, r.id, 'openclaw_agent_reaped', { run_id: r.run_id, exit });
  }
  return out;
}
