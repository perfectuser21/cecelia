/**
 * 秋米派发与收割真库 smoke（PR3-乙）：真 Postgres（cecelia_test）+ 假 ssh（execFileFn）。
 * 三闸——全部只碰「接线之后」这一层，判定层（routing/*）那三闸在 PR3-甲 的 qiumi-routing-smoke：
 *  1 收割：远端 .exit 落地（EXIT=0）→ completed_no_pr + result.receipt.exit=0 +
 *    回执里带 agent 末段 JSON 的可见结论 + task_events 有 openclaw_agent_reaped
 *  2 对照组：同一轮收割里另一条任务远端还没落 .exit（NO_EXIT）→ 原地 in_progress 不动、
 *    completed_at 仍为 NULL。这一条防的是「收割器把还在跑的活提前结账」。
 *  3 推送收窄：派生出去的 device_job 子任务就算带着中文页 id，也必须进不了
 *    PUSH_QIUMI_QUERY 的取数窗口——否则它会拿子任务的状态去改同一行中文表
 *    （子 queued 把行推回「委派」→ 下轮同步当新行二次入账；子失败写「推迟」并清空
 *    OpenClaw任务号，那是急停与重排的唯一锚）。
 *    带闸自检：先证明「去掉那道 task_type 收窄它确实会被选中」，否则 LIMIT 50
 *    把它挤出窗口时本闸就是假绿。
 *
 * 变异点写成文件顶部常量 GATE2_RUNNING_REPLY：把 'NO_EXIT\n' 改成 'EXIT=0\n'，
 * 闸 2 必红——那说明「还在跑的活不许被结账」是真在挡，不是顺带通过。
 *
 * ssh stub 按 run_id 分流：收割器的候选 SQL 是全库扫 in_progress 的 qiumi_task，
 * 不认自己的行就会把别人的行一起结账。只对自己的 run_id 回 EXIT，其余一律 NO_EXIT（= 不动）。
 *
 * 三闸的行全部直插、都不带路由回执，所以清理时整行删得掉。
 * 只删自己插的行（固定 title 前缀带 pid），绝不动别人的行。
 */
import pg from 'pg';
import { PUSH_QIUMI_QUERY } from '../../src/notion-gtd-sync.js';
import { reapOpenclawAgentRuns } from '../../src/openclaw-agent-executor.js';

// 闸 2 的变异点：改成 'EXIT=0\n' 后闸 2 必须由绿转红。
const GATE2_RUNNING_REPLY = 'NO_EXIT\n';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const T = `[smoke] qiumi-dispatch ${process.pid}`;
const RUN_DONE = `qiumi-smoke${process.pid}-done`;
const RUN_RUNNING = `qiumi-smoke${process.pid}-running`;

let passed = 0;
let failed = 0;
const pass = (gate, what) => { passed++; console.log(`  PASS 闸${gate} ${what}`); };
const bad = (gate, what) => { failed++; console.error(`  FAIL 闸${gate} ${what}`); };
const check = (gate, cond, what) => (cond ? pass(gate, what) : bad(gate, what));

async function insertTask(suffix, { taskType = 'qiumi_task', status = 'queued', payload = {} } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, task_type, status, priority, trigger_source, executor_kind, payload)
     VALUES ($1, $2, $3, 'P2', 'manual', 'openclaw-agent', $4::jsonb)
     RETURNING id, payload`,
    [`${T} ${suffix}`, taskType, status, JSON.stringify(payload)],
  );
  return rows[0];
}

const taskRow = async (id) => (await pool.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
const eventTypes = async (id) => (await pool.query(
  'SELECT event_type FROM task_events WHERE task_id = $1', [id],
)).rows.map((r) => r.event_type);

/** 只动自己插的行（固定 title 前缀带 pid）。三闸的行都没有路由回执，整行删得掉。 */
async function cleanup() {
  const { rows } = await pool.query('SELECT id FROM tasks WHERE title LIKE $1', [`${T}%`]);
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await pool.query('DELETE FROM task_events WHERE task_id = ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [ids]);
  }
}

async function main() {
  await cleanup();

  // ── 闸 1/2：收割。同一轮里一条远端已落 .exit，一条还没落 ──
  {
    const done = await insertTask('闸1', { payload: { run_id: RUN_DONE } });
    const running = await insertTask('闸2', { payload: { run_id: RUN_RUNNING } });
    // 收割只认 in_progress + openclaw-agent，这里把两条迁到收割的入口状态。
    await pool.query(
      `UPDATE tasks SET status='in_progress', executor_kind='openclaw-agent', started_at=NOW() WHERE id = ANY($1::uuid[])`,
      [[done.id, running.id]],
    );
    // 只对自己的 run_id 回 EXIT；别人的行一律 NO_EXIT（= 收割器原地不动，不替别人结账）。
    const execStub = (_file, args, _opts, cb) => {
      const cmd = String(args[args.length - 1]);
      if (cmd.includes(RUN_DONE)) {
        return cb(null, 'EXIT=0\n{"finalAssistantVisibleText":"smoke ✓"}', '');
      }
      if (cmd.includes(RUN_RUNNING)) {
        return cb(null, GATE2_RUNNING_REPLY, '');
      }
      return cb(null, 'NO_EXIT\n', '');
    };
    const out = await reapOpenclawAgentRuns(pool, { execFileFn: execStub });
    const d = await taskRow(done.id);
    const r = await taskRow(running.id);
    const events = await eventTypes(done.id);
    check(1, d.status === 'completed_no_pr', `status=${d.status}`);
    check(1, d.result?.receipt?.exit === 0, `result.receipt.exit=${JSON.stringify(d.result?.receipt?.exit)}`);
    check(1, d.result?.receipt?.text === 'smoke ✓', `回执可见结论=${d.result?.receipt?.text}`);
    check(1, events.includes('openclaw_agent_reaped'), `task_events 留痕=${events.join(',')}`);
    check(1, out.completed >= 1, `收割计数 completed=${out.completed}`);
    check(2, r.status === 'in_progress', `对照组原地不动，status=${r.status}`);
    check(2, r.completed_at === null, `对照组没被结账（completed_at=${r.completed_at}）`);
  }

  // ── 闸 3：中文表推送取数必须选不中 device_job 子任务 ──
  // 第一道闸是派生时根本不写 notion_zh_page_id（routing/qiumi-router.js，由 PR3-甲 的
  // qiumi-routing-smoke 闸 2 钉住）；这一条验的是 SQL 层那道 task_type 收窄——两道各管一头。
  {
    const zh = `smoke-zh-${process.pid}`;
    const child = await insertTask('闸3', { taskType: 'device_job', payload: { notion_zh_page_id: zh } });
    // 闸自检：先证明「去掉那道收窄它确实会被选中」，否则 LIMIT 50 把它挤出窗口时本闸就是假绿。
    const naked = PUSH_QIUMI_QUERY.replace(/\s*AND task_type = 'qiumi_task'/, '');
    check(3, naked !== PUSH_QIUMI_QUERY, '闸自检：PUSH_QIUMI_QUERY 里确实有那道 task_type 收窄');
    const wouldPush = (await pool.query(naked)).rows.map((x) => x.id);
    check(3, wouldPush.includes(child.id), '闸自检：去掉 task_type 收窄后子任务确实会被选中');
    const pushRows = (await pool.query(PUSH_QIUMI_QUERY)).rows.map((x) => x.id);
    check(3, !pushRows.includes(child.id), 'device_job 子任务不进中文表推送集合');
  }
}

try {
  await main();
} catch (err) {
  failed++;
  console.error(`FAIL 异常：${err.stack ?? err.message}`);
} finally {
  await cleanup().catch((e) => console.error(`清理失败：${e.message}`));
  await pool.end().catch(() => {});
}

console.log(failed === 0 ? `\nALL PASS（${passed} 项断言，3 闸全过）` : `\nFAILED：${failed} 项不通过 / ${passed} 项通过`);
process.exit(failed === 0 ? 0 : 1);
