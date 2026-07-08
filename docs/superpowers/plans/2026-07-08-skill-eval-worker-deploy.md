# skill-eval-worker 常驻部署 + HK 反代 + 端到端验证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `skill-eval-worker.js` 从"手动跑一次"变成"mmv 常驻 + HK 公网可达 + 已端到端验证"的服务。

**Architecture:** worker 增加超时回收器 → 用 pm2 + wrapper loop 常驻跑在 mmv（本机）→ HK VPS nginx 新增 location 反代到 mmv → 真实走一遍上传评估全链路 → 真库并发冒烟验证互斥。

**Tech Stack:** Node.js（ESM）、vitest、pg（`packages/brain/src/db.js` 连接池）、pm2、nginx（HK VPS）。

## Global Constraints

- 所有输出简体中文（提交信息、注释除外，遵循仓库现有风格：中文注释）。
- worker 保持 ESM 语法（`import`/`export`），与现有文件一致。
- 测试用 vitest，mock 方式与 `packages/brain/scripts/__tests__/skill-eval-worker.test.js` 现有模式保持一致（`vi.hoisted` + `vi.mock('../../src/db.js', ...)`）。
- 环境变量必须有默认值，禁止硬编码密钥/路径到脚本正文。
- pm2 / nginx 属于运维操作，不产生自动化 CI 覆盖；验证方式为手动执行 + 观察真实输出。
- **Task 4（HK nginx 反代）执行前必须先向用户说明风险并等待明确同意** —— 这是对生产共享 nginx 的网络配置变更，属于全局安全规则里的高风险操作，不因 /dev 自动化流程而跳过。

---

### Task 1: running 超时回收器 + 单测

**Files:**
- Modify: `packages/brain/scripts/skill-eval-worker.js`（在 `claimPendingTask` 之前新增 `reapStaleRunning`，并在 `runOnce()` 开头调用）
- Test: `packages/brain/scripts/__tests__/skill-eval-worker.test.js`（新增 describe 块）

**Interfaces:**
- Produces: `export async function reapStaleRunning(timeoutMinutes = 10)` — 无返回值必须字段，返回 `{ recovered: number }`（重置的行数），供后续冒烟/日志使用。
- Consumes: 现有 `pool`（`../src/db.js` default export），与 `claimPendingTask` 共用同一个连接池。

- [ ] **Step 1: 写失败测试**

在 `packages/brain/scripts/__tests__/skill-eval-worker.test.js` 顶部 import 里加入 `reapStaleRunning`：

```javascript
import { sanitizeJsonString, extractReportJson, claimPendingTask, reapStaleRunning } from '../skill-eval-worker.js';
```

在文件末尾新增：

```javascript
describe('reapStaleRunning — 超时 running 任务回收', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  it('发出 UPDATE 把超时的 running 任务重置为 pending，并返回重置行数', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 2, rows: [] });
    const result = await reapStaleRunning(10);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE\s+skill_evals/i);
    expect(sql).toMatch(/SET\s+status\s*=\s*'pending'/i);
    expect(sql).toMatch(/WHERE\s+status\s*=\s*'running'/i);
    expect(sql).toMatch(/updated_at\s*<\s*now\(\)\s*-\s*(\$1 \* )?interval/i);
    expect(result).toEqual({ recovered: 2 });
  });

  it('默认超时阈值为 10 分钟', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await reapStaleRunning();
    const [, params] = mockPool.query.mock.calls[0];
    expect(params).toContain(10);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run scripts/__tests__/skill-eval-worker.test.js`
Expected: FAIL — `reapStaleRunning is not a function` / import error。

- [ ] **Step 3: 写最小实现**

在 `packages/brain/scripts/skill-eval-worker.js` 里，`claimPendingTask` 函数**之前**插入：

```javascript
/**
 * 回收超时卡死的 running 任务：worker 进程崩溃/被杀后，claimPendingTask 抢到的任务
 * 会永久卡在 status='running'（原实现遗留问题）。常驻多实例部署后这个问题会被放大，
 * 因此每次 runOnce() 之前先扫一次，把超过阈值仍未完成的任务退回 pending 重新排队。
 * @param {number} timeoutMinutes 超时阈值（分钟），默认 10
 * @returns {Promise<{recovered: number}>}
 */
export async function reapStaleRunning(timeoutMinutes = 10) {
  const { rowCount } = await pool.query(
    `UPDATE skill_evals
     SET status = 'pending', updated_at = now()
     WHERE status = 'running'
       AND updated_at < now() - ($1 * interval '1 minute')`,
    [timeoutMinutes]
  );
  return { recovered: rowCount };
}
```

然后在 `runOnce()` 函数开头（`export async function runOnce() {` 之后第一行）加入回收调用：

```javascript
export async function runOnce() {
  const { recovered } = await reapStaleRunning();
  if (recovered > 0) {
    console.log(`[skill-eval-worker] 回收 ${recovered} 个超时 running 任务`);
  }

  const claimed = await claimPendingTask();
  // ...（原有逻辑不变）
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run scripts/__tests__/skill-eval-worker.test.js`
Expected: PASS，全部 case 变绿。

- [ ] **Step 5: Commit**

```bash
git add packages/brain/scripts/skill-eval-worker.js packages/brain/scripts/__tests__/skill-eval-worker.test.js
git commit -m "feat: skill-eval-worker 加超时 running 任务回收器"
```

---

### Task 2: pm2 常驻 wrapper loop 脚本

**Files:**
- Create: `packages/brain/scripts/skill-eval-worker-loop.sh`

**Interfaces:**
- Consumes: `packages/brain/scripts/skill-eval-worker.js`（Task 1 产出，`runOnce()` 跑完即退出）
- Produces: 可执行 shell 脚本，供 pm2 以 fork 模式常驻管理；退出码传递给 pm2（脚本本身是死循环，正常不退出）

- [ ] **Step 1: 写脚本**

```bash
#!/usr/bin/env bash
# skill-eval-worker-loop.sh — 把单次执行的 skill-eval-worker.js 包成常驻循环
# runOnce() 跑完一次任务（或发现没有 pending 任务）就退出进程，
# 因此不能直接用 `pm2 start skill-eval-worker.js` ——需要这层 wrapper 反复拉起它，
# 让 pm2 只需要管好这一个 wrapper 进程的存活（对齐仓库已有先例 gemini-relay/douyin-proxy）。
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while true; do
  node "$SCRIPT_DIR/skill-eval-worker.js"
  sleep 5
done
```

- [ ] **Step 2: 赋可执行权限**

Run: `chmod +x packages/brain/scripts/skill-eval-worker-loop.sh`
Expected: 无输出（成功）。

- [ ] **Step 3: 本地冒烟（不接 pm2，先验证脚本本身能循环调用）**

Run（后台跑 8 秒后杀掉，观察是否至少打印两次 "没有 pending 任务，退出"）：

```bash
cd packages/brain
timeout 8 bash scripts/skill-eval-worker-loop.sh 2>&1 | tee /tmp/loop-smoke.log || true
grep -c "没有 pending 任务" /tmp/loop-smoke.log
```

Expected: 计数 ≥ 1（说明 wrapper 确实在反复拉起 `runOnce()`）。若报数据库连接错误属于预期（本地未必有 DATABASE_URL），只要能看到脚本反复执行 node 进程（而非报 "command not found" 之类的脚本本身语法错误）即算通过；用 `bash -n scripts/skill-eval-worker-loop.sh` 额外确认语法。

Run: `bash -n packages/brain/scripts/skill-eval-worker-loop.sh`
Expected: 无输出，退出码 0（语法检查通过）。

- [ ] **Step 4: Commit**

```bash
git add packages/brain/scripts/skill-eval-worker-loop.sh
git commit -m "feat: 新增 skill-eval-worker pm2 常驻 wrapper loop 脚本"
```

---

### Task 3: 真库并发冒烟脚本

**Files:**
- Create: `packages/brain/scripts/skill-eval-concurrency-smoke.js`

**Interfaces:**
- Consumes: `claimPendingTask` from `./skill-eval-worker.js`（Task 1 之前已存在的导出），`pool` from `../src/db.js`
- Produces: 独立可执行诊断脚本（非测试套件成员，手动运行），运行结束打印 PASS/FAIL 并以 `process.exit(0|1)` 退出

- [ ] **Step 1: 写脚本**

```javascript
#!/usr/bin/env node
/**
 * skill-eval-concurrency-smoke.js — 对真实 Postgres 验证 claimPendingTask() 的并发互斥。
 * 插两条 pending fixture，并发调用两次 claimPendingTask()，断言只有一条成功、一条为 null，
 * 跑完清理掉自己插入的 fixture 行（用 zip_hash 前缀标记，避免误删其它数据）。
 *
 * 用法：node packages/brain/scripts/skill-eval-concurrency-smoke.js
 * 需要真实 DATABASE_URL（走 ../src/db.js 同一套连接配置）。
 */
import pool from '../src/db.js';
import { claimPendingTask } from './skill-eval-worker.js';

const MARK = `smoke-${Date.now()}`;

async function main() {
  const insertOne = async (n) => {
    const { rows } = await pool.query(
      `INSERT INTO skill_evals (zip_hash, skill_name, status, staging_path)
       VALUES ($1, $2, 'pending', $3)
       RETURNING task_id`,
      [`${MARK}-${n}`, `smoke-skill-${n}`, `/tmp/${MARK}-${n}.zip`]
    );
    return rows[0];
  };

  await insertOne(1);
  await insertOne(2);

  const [a, b] = await Promise.all([claimPendingTask(), claimPendingTask()]);
  const claimedCount = [a, b].filter(Boolean).length;

  await pool.query(`DELETE FROM skill_evals WHERE zip_hash LIKE $1`, [`${MARK}%`]);

  if (claimedCount === 2 && a.task_id !== b.task_id) {
    console.log('[smoke] PASS：两次并发调用各取到不同任务，互斥生效');
    process.exit(0);
  } else {
    console.error(`[smoke] FAIL：claimedCount=${claimedCount}, a=${JSON.stringify(a)}, b=${JSON.stringify(b)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[smoke] 脚本执行出错:', err);
  process.exit(1);
});
```

> 注：`skill_evals` 表 PK 是 `id`，但 `claimPendingTask` RETURNING 的是 `task_id`（外键到 `tasks(id)`，允许为 null）。插入 fixture 时不传 `task_id`，会保持 NULL；若真库对 `task_id` 有非空约束需要调整，执行时先跑 `\d skill_evals` 确认（migration 318 未见 NOT NULL，预期允许 NULL）。

- [ ] **Step 2: 语法检查**

Run: `node --check packages/brain/scripts/skill-eval-concurrency-smoke.js`
Expected: 无输出，退出码 0。

- [ ] **Step 3: Commit**

```bash
git add packages/brain/scripts/skill-eval-concurrency-smoke.js
git commit -m "feat: 新增 skill-eval-worker 真库并发冒烟脚本"
```

（真实执行此脚本、验证结果放在 Task 6，需要真实 DATABASE_URL 连到 mmv 上的 Postgres。）

---

### Task 4: mmv pm2 常驻部署（运维操作）

**Files:** 无代码改动，纯运维步骤（在 mmv 本机执行，不产生 git diff）。

**Interfaces:**
- Consumes: Task 2 产出的 `skill-eval-worker-loop.sh`
- Produces: 一个名为 `skill-eval-worker` 的 pm2 常驻进程

- [ ] **Step 1: 确认环境变量**

Run: `source ~/.credentials/1password.env 2>/dev/null; ls /Users/administrator/perfect21/skill-eval-formb-assets/eval-prompt.txt`
Expected: 文件存在（`EVAL_PROMPT_PATH` 默认值有效）。若不存在，需先定位正确路径再继续。

- [ ] **Step 2: pm2 启动**

Run（在仓库主目录，非 worktree——pm2 常驻进程跑的是**已合并到 main 后的**脚本路径，本步骤在本 PR merge 后执行；开发阶段先确认命令语法）：

```bash
cd /Users/administrator/perfect21/cecelia
pm2 start packages/brain/scripts/skill-eval-worker-loop.sh --name skill-eval-worker
pm2 save
pm2 list | grep skill-eval-worker
```

Expected: `pm2 list` 显示 `skill-eval-worker` 状态 `online`。

- [ ] **Step 3: 验证崩溃自动拉起**

Run: `pm2 pid skill-eval-worker` 拿到 pid → `kill -9 <pid>` → 等 2 秒 → `pm2 list | grep skill-eval-worker`
Expected: 状态仍为 `online`（pm2 自动重启了子进程），`restart` 计数 +1。

- [ ] **Step 4: 无 commit（运维操作不产生代码变更）**

---

### Task 5: HK VPS `/eval-api` nginx 反代（⚠️ 高风险，需用户确认后执行）

**Files:** 无本仓库代码改动（改的是 HK VPS 上的 nginx 配置文件，不在本 repo）。

**Interfaces:**
- Consumes: mmv 上 Task 4 已启动的 `http://38.23.47.81:5221/api/skill-eval/*`
- Produces: HK 侧公网可达的 `https://<hk-domain>/eval-api/*`

- [ ] **Step 1: 执行前置确认（阻塞点）**

在真正 ssh 上 HK VPS 改 nginx 之前，必须先把以下内容告知用户并等待明确同意，再继续：
- 将要改动：HK VPS（100.86.118.99，仅 Tailscale 可达）现有 nginx 配置，新增一个 location block
- 风险：nginx `-t` 校验失败会阻止 reload（不影响现有站点）；若校验通过但转发规则写错，可能导致 `/eval-api/*` 404 或超时，但不会影响 HK 上其它 server block（新增不覆盖）
- 回滚方式：改动前 `cp` 备份原配置文件，出问题直接恢复备份再 `nginx -s reload`

- [ ] **Step 2: 勘查现状**

Run（SSH 到 HK VPS）：

```bash
ssh root@100.86.118.99 "nginx -T 2>/dev/null | grep -A5 'server_name\|listen'"
```

Expected: 看到现有 server block 列表，确定用哪个 server_name 挂 `/eval-api` location（或是否需要新开一个 server block）。

- [ ] **Step 3: 备份 + 新增 location**

```bash
ssh root@100.86.118.99 "cp /etc/nginx/sites-available/<确认后的配置文件> /etc/nginx/sites-available/<同名>.bak-$(date +%Y%m%d%H%M)"
```

在对应 server block 内新增（具体文件路径以 Step 2 勘查结果为准）：

```nginx
location /eval-api/ {
    proxy_pass http://38.23.47.81:5221/api/skill-eval/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_connect_timeout 10s;
    proxy_read_timeout 60s;
}
```

- [ ] **Step 4: 校验 + reload**

```bash
ssh root@100.86.118.99 "nginx -t && nginx -s reload"
```

Expected: `nginx -t` 输出 `syntax is ok` / `test is successful`，reload 无报错。

- [ ] **Step 5: 验证反代生效**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<hk-domain>/eval-api/status/nonexistent-task-id
```

Expected: 收到 mmv 侧 Brain 的响应状态码（非 502/504，说明反代链路通了；具体是 404 还是其它取决于路由实现，只要不是网关错误即视为通）。

- [ ] **Step 6: 无 commit（HK 侧配置不在本仓库）**——在 sprint 记录里注明改动内容与备份路径，供后续排查。

---

### Task 6: 端到端验证 + 并发冒烟执行

**Files:** 无新代码（复用 Task 3 脚本 + 临时生成的 fixture zip）

**Interfaces:**
- Consumes: Task 1（回收器）、Task 4（mmv 常驻）、Task 5（HK 反代）、Task 3（并发冒烟脚本）

- [ ] **Step 1: 准备最小 skill zip fixture**

```bash
mkdir -p /tmp/e2e-skill-fixture/e2e-smoke-skill
cat > /tmp/e2e-skill-fixture/e2e-smoke-skill/SKILL.md << 'EOF'
---
name: e2e-smoke-skill
description: 端到端冒烟用最小 skill
---

# E2E Smoke Skill

一个只用于验证 skill-eval-worker 全链路的最小骨架 skill。
EOF
cd /tmp/e2e-skill-fixture && zip -r /tmp/e2e-smoke-skill.zip e2e-smoke-skill
```

Expected: `/tmp/e2e-smoke-skill.zip` 生成成功。

- [ ] **Step 2: 上传并轮询**

```bash
TASK_ID=$(curl -s -F "file=@/tmp/e2e-smoke-skill.zip" localhost:5221/api/skill-eval | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).task_id))")
echo "task_id=$TASK_ID"
for i in $(seq 1 30); do
  STATUS=$(curl -s "localhost:5221/api/skill-eval/status/$TASK_ID" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).status))")
  echo "poll $i: $STATUS"
  [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] && break
  sleep 5
done
```

Expected: 最终 `STATUS=completed`（若为 `failed`，需要停下排查 worker 日志，不允许直接判定本任务完成）。

- [ ] **Step 3: 拉报告**

```bash
curl -s "localhost:5221/api/skill-eval/report/$TASK_ID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d);console.log('has report_data:', !!r.report_data || !!r.report_url);})"
```

Expected: 输出 `has report_data: true`。

- [ ] **Step 4: 公网路径验证**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://<hk-domain>/eval-api/status/$TASK_ID"
```

Expected: HTTP 200，且返回体与直连 mmv 的结果一致（可用 `curl -s` 两边输出 diff 对比）。

- [ ] **Step 5: 运行并发冒烟脚本**

```bash
node packages/brain/scripts/skill-eval-concurrency-smoke.js
```

Expected: 打印 `[smoke] PASS`，退出码 0。

- [ ] **Step 6: 清理 fixture**

```bash
rm -rf /tmp/e2e-skill-fixture /tmp/e2e-smoke-skill.zip /tmp/loop-smoke.log
```

---

## 验收标准回执（对应设计文档）

- [ ] Task 1 单测 + CI 全绿
- [ ] Task 4：mmv `pm2 list` 显示 online，kill 后自动拉起
- [ ] Task 5：HK `/eval-api/*` 反代生效
- [ ] Task 6：真实上传→完整链路→报告可查
- [ ] Task 6：并发冒烟 PASS
