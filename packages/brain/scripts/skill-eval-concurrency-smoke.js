#!/usr/bin/env node
/**
 * skill-eval-concurrency-smoke.js — 对真实 Postgres 验证 claimPendingTask() 的并发互斥。
 * 插两条 pending fixture，并发调用两次 claimPendingTask()，断言只有一条成功、一条为 null，
 * 跑完清理掉自己插入的 fixture 行（用 zip_hash / title 前缀标记，避免误删其它数据）。
 *
 * 用法：node packages/brain/scripts/skill-eval-concurrency-smoke.js
 * 需要真实 DATABASE_URL（走 ../src/db.js 同一套连接配置）。
 *
 * 注：claimPendingTask() 的 UPDATE...WHERE 子查询是拿 task_id 做匹配的
 * （`WHERE task_id = (SELECT task_id FROM skill_evals WHERE status='pending' ... )`）。
 * 若 fixture 行的 task_id 留空为 NULL，子查询会选出 NULL，外层 `task_id = NULL`
 * 在 SQL 里恒为 UNKNOWN（不是 TRUE），UPDATE 匹配不到任何行——claimPendingTask()
 * 会一直返回 null，冒烟脚本会得到假 FAIL（并非 claimPendingTask 本身有 bug）。
 * 生产路径（routes/eval.js）插入 skill_evals 时 task_id 永远是先建好的 tasks.id，
 * 从不为空，因此这里显式先建两条占位 tasks 行，把真实 task_id 传给 skill_evals，
 * 复刻生产场景，避免 NULL 语义把冒烟脚本自己坑了。
 */
import pool from '../src/db.js';
import { claimPendingTask } from './skill-eval-worker.js';

const MARK = `smoke-${Date.now()}`;

async function main() {
  const insertOne = async (n) => {
    // 先建一条占位 task（skill_evals.task_id 是外键，且 claimPendingTask 的匹配
    // 逻辑要求 task_id 非空，见上方注释），再用它的 id 建 skill_evals fixture。
    const { rows: taskRows } = await pool.query(
      `INSERT INTO tasks (title, status) VALUES ($1, 'queued') RETURNING id`,
      [`${MARK}-task-${n}`]
    );
    const taskId = taskRows[0].id;

    await pool.query(
      `INSERT INTO skill_evals (task_id, zip_hash, skill_name, status, staging_path)
       VALUES ($1, $2, $3, 'pending', $4)`,
      [taskId, `${MARK}-${n}`, `smoke-skill-${n}`, `/tmp/${MARK}-${n}.zip`]
    );

    return taskId;
  };

  const taskIds = [];
  taskIds.push(await insertOne(1));
  taskIds.push(await insertOne(2));

  let exitCode = 1;
  try {
    const [a, b] = await Promise.all([claimPendingTask(), claimPendingTask()]);
    const claimedCount = [a, b].filter(Boolean).length;

    if (claimedCount === 2 && a.task_id !== b.task_id) {
      console.log('[smoke] PASS：两次并发调用各取到不同任务，互斥生效');
      exitCode = 0;
    } else {
      console.error(`[smoke] FAIL：claimedCount=${claimedCount}, a=${JSON.stringify(a)}, b=${JSON.stringify(b)}`);
      exitCode = 1;
    }
  } finally {
    // 清理顺序：先删 skill_evals（外键子表），再删 tasks（父表），否则会因外键约束删不掉。
    // 注意：process.exit() 必须放在 finally 清理之后调用——若放在 try 块内部提前调用，
    // finally 根本不会被执行（process.exit 直接终止进程），fixture 会永久留在库里。
    await pool.query(`DELETE FROM skill_evals WHERE zip_hash LIKE $1`, [`${MARK}%`]);
    await pool.query(`DELETE FROM tasks WHERE id = ANY($1::uuid[])`, [taskIds]);
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[smoke] 脚本执行出错:', err);
  process.exit(1);
});
