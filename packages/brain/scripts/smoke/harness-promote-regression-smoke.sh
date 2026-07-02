#!/usr/bin/env bash
# harness-promote-regression-smoke.sh
# 真环境 smoke：A3 promoteToRegression 的 DB 冻结层 + 解析/幂等纯函数全链路。
# git/gh 外部调用注入 no-op mock（smoke 不真开 PR），yaml 写到临时目录。
set -euo pipefail

DB_URL="${DATABASE_URL:-${DB_URL:-postgresql://localhost/cecelia}}"
export SMOKE_DB_URL="$DB_URL"

echo "[smoke] A3 promote-regression — DB=$DB_URL"
cd "$(dirname "$0")/../.."   # → packages/brain

node --input-type=module -e '
import { promoteToRegression, parseBehaviorEntries, mergeGoldenPaths } from "./src/harness-promote-regression.js";
import pg from "pg";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pool = new pg.Pool({ connectionString: process.env.SMOKE_DB_URL });
const client0 = await pool.connect();

// 夹具：真实 task
const t = await client0.query("INSERT INTO tasks (title) VALUES ($1) RETURNING id", ["a3-smoke-task-" + Date.now()]);
const taskId = t.rows[0].id;
client0.release();

// 临时 worktree 目录 + sprint 文件
const wt = fs.mkdtempSync(path.join(os.tmpdir(), "a3-smoke-"));
const sprintDir = "sprints/a3-smoke";
fs.mkdirSync(path.join(wt, sprintDir), { recursive: true });
fs.writeFileSync(path.join(wt, sprintDir, "sprint-prd.md"), "## Golden Path\n1. 步骤一\n2. 步骤二\n");
fs.writeFileSync(path.join(wt, sprintDir, "contract-dod.md"), "- [ ] [BEHAVIOR] 行为一\n  Test: manual:true\n");
fs.writeFileSync(path.join(wt, "regression-contract.yaml"), "version: \"1.0.0\"\ncore: []\ngolden_paths: []\n");

// execFile mock：git/gh 全 no-op（ls-files 成功 = 视为已跟踪）
const execFileMock = async () => ({ stdout: "https://example.com/pr/1", stderr: "" });

const r1 = await promoteToRegression(
  { pool, execFile: execFileMock },
  { task: { id: taskId, payload: {} }, sprintDir, subTasks: [], worktreePath: wt },
);
if (!r1.dbWritten) { console.error("FAIL: dbWritten=false", r1); process.exit(1); }

const c1 = await pool.query("SELECT count(*)::int AS n FROM golden_path WHERE owner_task_id=$1", [taskId]);
if (c1.rows[0].n !== 2) { console.error("FAIL: golden_path 行数=" + c1.rows[0].n + " 期望 2"); process.exit(1); }
console.log("✓ golden_path 表覆盖写 2 行");

// 幂等：再跑一次不翻倍
const r2 = await promoteToRegression(
  { pool, execFile: execFileMock },
  { task: { id: taskId, payload: {} }, sprintDir, subTasks: [], worktreePath: wt },
);
const c2 = await pool.query("SELECT count(*)::int AS n FROM golden_path WHERE owner_task_id=$1", [taskId]);
if (c2.rows[0].n !== 2) { console.error("FAIL: 二次跑后行数=" + c2.rows[0].n + " 期望 2（覆盖非叠加）"); process.exit(1); }
console.log("✓ 幂等：二次 PASS 覆盖不叠加");

// yaml 冻结形态（本地文件层断言）
const yaml = fs.readFileSync(path.join(wt, "regression-contract.yaml"), "utf8");
if (!yaml.includes("GP-" + String(taskId).slice(0,8) + "-001") || !yaml.includes("test_command")) {
  console.error("FAIL: yaml 冻结条目缺失"); process.exit(1);
}
console.log("✓ regression-contract.yaml 冻结条目含 id + test_command");

// 清理
await pool.query("DELETE FROM golden_path WHERE owner_task_id=$1", [taskId]);
await pool.query("DELETE FROM tasks WHERE id=$1", [taskId]);
fs.rmSync(wt, { recursive: true, force: true });
await pool.end();
console.log("✅ harness-promote-regression-smoke 全链路通过");
'
