/**
 * 已登记技能任务的核验周期：只消费终态Task并核验、记账，不根据台账自行生产新工作。
 *
 * 旧推进器开关不控制正常任务核验；周期互斥与节流保持。
 */
import { recordRun } from './factory-ledger.js';
import { makeJudgeStore, runFactoryJudge } from './factory-judge.js';
import { resolveWorkflowConfig } from './factory-workflow-config.js';

export const FACTORY_CYCLE_INTERVAL_MS = Number(process.env.FACTORY_PUSHER_INTERVAL_MS) > 0
  ? Number(process.env.FACTORY_PUSHER_INTERVAL_MS) : 5 * 60 * 1000;

/**
 * 工厂执行单改走 Commander+外壳的开关（任务 c0fe7e30）：brain_config key=factory_commander_route_enabled value=true 才开，
 * 默认关、读不到按关（zenithjoy 侧 Commander/外壳没部署前开了会让执行单全部 exit 4 污染台账）。
 */
export async function isFactoryCommanderRouteEnabled(db) {
  try {
    const { rows } = await db.query("SELECT value FROM brain_config WHERE key = 'factory_commander_route_enabled'");
    return rows.length > 0 && ['true', '"true"', '1', 'on'].includes(String(rows[0].value).trim().toLowerCase());
  } catch {
    return false;
  }
}

/** 旧台账自主推进入口已退役；明确登记Task后由现行执行器完成工作。 */
export async function runFactoryPusher() {
  throw Object.assign(new Error('台账自主建单已退役；请先明确登记工作任务'), { status: 410, code: 'FACTORY_PUSHER_RETIRED' });
}

/** tick 入口：已有任务裁判（进程内互斥，上一轮没跑完跳过）。deps 可注入（测试）。 */
let cycleRunning = false;
let lastRunAt = 0;
/** 调度器每 60s 全调所有 job（cadence 只是声明），这里按 FACTORY_CYCLE_INTERVAL_MS 自 gate；deps.force 越过（smoke 用）。 */
export async function runFactoryCycle(db, deps = {}) {
  const nowMs = (deps.now ? deps.now() : new Date()).getTime();
  if (!deps.force && nowMs - lastRunAt < FACTORY_CYCLE_INTERVAL_MS) return { skipped: 'throttled' };
  if (cycleRunning) return { skipped: 'running' };
  lastRunAt = nowMs;
  cycleRunning = true;
  try { return await runCycleOnce(db, deps); } finally { cycleRunning = false; }
}

async function runCycleOnce(db, deps) {
  const createTask = deps.createTask || (async (args) => (await import('../actions.js')).createTask(args));
  const log = deps.log || ((m) => console.log(`[factory-cycle] ${m}`));
  const resolveConfig = deps.resolveConfig || ((key) => resolveWorkflowConfig(key));
  const judge = await runFactoryJudge({
    store: deps.judgeStore || makeJudgeStore(db), createTask, resolveConfig, log, now: deps.now,
    recordRun: deps.recordRun || ((id, body) => recordRun(db, id, body)),
  });
  return { judge };
}
