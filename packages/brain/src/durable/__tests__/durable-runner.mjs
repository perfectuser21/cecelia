/**
 * durable-runner.mjs — daily-report-durable 崩溃恢复测试的子进程入口。
 *
 * 被 daily-report-durable.test.js 以 child_process 形式 spawn，验证真 DBOS recover：
 *   MODE=start   → 启动 workflow，在 saveReport 前 CRASH（process.exit137）
 *   MODE=recover → 重启 DBOS.launch() 触发自动 recover，等 workflow 完成
 *
 * 断言数据落在 TEST_PG 指向的测试库：
 *   - step_trace：每个 step body 实际执行一次写一行（recover 后已完成 step 不重跑 → 计数不增）
 *   - feishu_sends：sendFeishu 执行一次写一行（exactly-once → 全程恰好 1 行）
 *
 * DBOS 系统表落测试库的 dbos schema（与 spike 同形态，systemDatabaseUrl 指向测试库本身）。
 */

import { DBOS } from '@dbos-inc/dbos-sdk';
import pg from 'pg';
import { buildDurableDailyReport } from '../daily-report-durable.js';

const TEST_DB_URL = process.env.TEST_DB_URL;
const MODE = process.env.MODE;
const WF_ID = process.env.WF_ID || 'durable-daily-report-test';

const pool = new pg.Pool({ connectionString: TEST_DB_URL, max: 5 });

async function trace(step) {
  await pool.query('INSERT INTO step_trace(step, pid) VALUES ($1, $2)', [step, process.pid]);
}

async function sendFeishu(text) {
  await pool.query('INSERT INTO feishu_sends(pid, note) VALUES ($1, $2)', [process.pid, String(text).slice(0, 60)]);
}

async function main() {
  DBOS.setConfig({
    name: 'durable-daily-report-test',
    systemDatabaseUrl: TEST_DB_URL,
    systemDatabaseSchemaName: 'dbos',
    systemDatabasePoolSize: 5,
  });
  await DBOS.launch();

  // 固定 now → today/yesterday 稳定（业务查询不依赖真数据，空结果即可）
  const now = new Date('2026-06-21T01:00:00Z');
  const workflow = buildDurableDailyReport({ pool, sendFeishu, now, trace });

  if (MODE === 'start') {
    const handle = await DBOS.startWorkflow(workflow, { workflowID: WF_ID })();
    try {
      await handle.getResult();
    } catch {
      // 崩溃路径不会走到这；若走到说明非预期
    }
  } else {
    // recover：launch 已触发 pending workflow 自动恢复，等其完成
    const handle = DBOS.retrieveWorkflow(WF_ID);
    const res = await handle.getResult();
    console.log('[durable-test] recovered result:', JSON.stringify(res));
  }

  await DBOS.shutdown();
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error('[durable-test] runner FATAL:', String(e).slice(0, 300));
  process.exit(1);
});
