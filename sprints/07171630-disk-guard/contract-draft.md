# Contract Draft: disk-guard

**TASK_ID**: ba6fe51c-0948-48da-8889-beb1aa14ede8
**Sprint**: 07171630-disk-guard
**版本**: v1.0
**日期**: 2026-07-17

---

## 判定点登记表

| # | [BEHAVIOR] | 对应 PRD 测试 | 优先级 | 状态 |
|---|-----------|--------------|--------|------|
| 1 | [BEHAVIOR-1] df 87% 触发完整清理序列，严格按 INV-04 顺序（container→builder→worktrees→cache） | T-01 | P0 | ⬜ |
| 2 | [BEHAVIOR-2] df 75% 不触发任何清理，日志含 `action=none` | T-02 | P0 | ⬜ |
| 3 | [BEHAVIOR-3] df 82% 仅发飞书告警，不触发清理 | T-03 | P0 | ⬜ |
| 4 | [BEHAVIOR-4] 清后复测仍 ≥90% 发 Bark 推送 | T-04 | P0 | ⬜ |
| 5 | [BEHAVIOR-5] 终态 worktree 超 24h 被删除 | T-05 | P0 | ⬜ |
| 6 | [BEHAVIOR-6] in_progress worktree 绝对不删（INV-01 回归） | T-06 | P0-REGRESSION | ⬜ |
| 7 | [BEHAVIOR-7] 查不到 task 记录的 worktree 跳过（fail-open） | T-07 | P0 | ⬜ |
| 8 | [BEHAVIOR-8] scheduler-jobs JOBS 含 disk-guard 条目，参数规格正确 | T-08 | P0 | ⬜ |
| 9 | [BEHAVIOR-9] df 命令失败时 catch 并打 error 日志，不静默失败 | NFR-可靠性 | P1 | ⬜ |
| 10 | [BEHAVIOR-10] 15min 内重复调用节流 gate，df 只执行一次 | FR-01 节拍 | P1 | ⬜ |

---

## 合同测试表

| [BEHAVIOR] | 测试文件 | it() 描述 |
|-----------|---------|-----------|
| BEHAVIOR-1 | `sprints/07171630-disk-guard/tests/disk-guard.test.js` | `[BEHAVIOR-1] df 87% 触发完整清理序列，序列按 INV-04 顺序` |
| BEHAVIOR-2 | `sprints/07171630-disk-guard/tests/disk-guard.test.js` | `[BEHAVIOR-2] df 75% 不触发清理，打 action=none 日志` |
| BEHAVIOR-3 | `sprints/07171630-disk-guard/tests/disk-guard.test.js` | `[BEHAVIOR-3] df 82% 仅发飞书告警，不触发清理序列` |
| BEHAVIOR-4 | `sprints/07171630-disk-guard/tests/disk-guard.test.js` | `[BEHAVIOR-4] 清后复测仍 ≥90% 发 Bark 推送` |
| BEHAVIOR-5 | `sprints/07171630-disk-guard/tests/worktree-reaper.test.js` | `[BEHAVIOR-5] 终态任务 updated_at 超 25h，目录被删除` |
| BEHAVIOR-6 | `sprints/07171630-disk-guard/tests/worktree-reaper.test.js` | `[BEHAVIOR-6][回归] in_progress worktree 绝对不删（INV-01 防第 6 次误杀）` |
| BEHAVIOR-7 | `sprints/07171630-disk-guard/tests/worktree-reaper.test.js` | `[BEHAVIOR-7] task 查不到记录，跳过不删（fail-open）` |
| BEHAVIOR-8 | `sprints/07171630-disk-guard/tests/disk-guard.test.js` | `[BEHAVIOR-8] scheduler-jobs JOBS 含 disk-guard，参数规格正确` |
| BEHAVIOR-9 | `sprints/07171630-disk-guard/tests/disk-guard.test.js` | `[BEHAVIOR-9] df 命令失败时 catch 并打 error 日志，不静默吞掉` |
| BEHAVIOR-10 | `sprints/07171630-disk-guard/tests/disk-guard.test.js` | `[BEHAVIOR-10] 15min 内重复调用节流 gate，df 只执行一次` |

---

## E2E 验收

以下命令在 Brain 容器（cecelia-node-brain）内执行验收。
**注**：PR 合并前使用 Preview Brain（端口 5324，从 worktree 加载 PR 代码）；合并后端口改为 5221。

```bash
# === Step 1：触发一轮 disk-guard ===
# 使用 /api/brain/cron/trigger 通用端点（PR #4050 新增）
curl -s -X POST http://localhost:5324/api/brain/cron/trigger \
  -H "Content-Type: application/json" \
  -d '{"job":"disk-guard"}' | jq .

# === Step 2：等待执行完成（最多 30s）===
sleep 5

# === Step 3：验证 INV-03——[disk_check] 日志必出 ===
LOG_HIT=$(cat /tmp/preview-4050.log | grep '\[disk_check\]' | tail -3)

if [ -z "$LOG_HIT" ]; then
  echo "FAIL: 未找到 [disk_check] 日志（INV-03 违反）"
  exit 1
else
  echo "PASS: [disk_check] 日志已找到"
  echo "$LOG_HIT"
fi

# === Step 4：验证 action 字段存在 ===
echo "$LOG_HIT" | grep -E 'action=(none|warn|clean|bark)' \
  && echo "PASS: action 字段格式正确" \
  || { echo "FAIL: action 字段缺失或格式错误"; exit 1; }

# === Step 5：验证 scheduler-jobs 注册（smoke 脚本）===
cd /Users/administrator/perfect21/cecelia/.claude/worktrees/harness-v2/task-ba6fe51c
bash packages/brain/scripts/smoke/disk-guard-smoke.sh

# === Step 6（回归）：in_progress worktree 保护验证 ===
WORKTREE_BASE="/Users/administrator/perfect21/cecelia/.claude/worktrees/harness-v2"
TEST_DIR="$WORKTREE_BASE/task-e2etest1"
mkdir -p "$TEST_DIR"
echo "created test worktree: $TEST_DIR"

# 触发 worktree-reaper（task-e2etest1 在 DB 中不存在 → fail-open → 不删）
curl -s -X POST http://localhost:5324/api/brain/cron/trigger \
  -H "Content-Type: application/json" \
  -d '{"job":"worktree-reaper"}' | jq .
sleep 5

if [ -d "$TEST_DIR" ]; then
  echo "PASS: fail-open 生效，未知 task 的 worktree 未被删除"
  rmdir "$TEST_DIR"
else
  echo "FAIL: worktree 被意外删除（INV-01 违反）"
  exit 1
fi

echo ""
echo "=== E2E 验收完成 ==="
```

---

## 未覆盖真实链路清单

以下内容在单元测试中被 mock，无法在单测层面验证真实行为，需 E2E 或手动验收：

| # | 被 mock 的部分 | 真实链路 | 替代验收方式 |
|---|--------------|---------|------------|
| 1 | `execAsync`（SSH 宿主机 + df 命令） | 实际 SSH 到宿主机执行 `df /System/Volumes/Data`，输出格式取决于 macOS 版本 | E2E Step 3 日志验证；本地手动跑一次 `df /System/Volumes/Data` 确认格式 |
| 2 | `execAsync`（docker container prune / builder prune） | 实际执行 docker 命令，会清理真实容器/缓存 | 在测试/staging 环境执行一次；生产触发前确认磁盘水位 |
| 3 | `execAsync`（npm cache clean / brew cleanup） | 实际清理本机 npm/homebrew 缓存 | 手动验收；E2E 只验证日志，不验证缓存大小变化 |
| 4 | Brain DB 查询（worktree-reaper task 状态） | 实际查 `packages/brain/src/db.js` pool，连接 PostgreSQL `cecelia` 库 | 需要 Brain 运行时 + DB 中有真实 task 记录 |
| 5 | 飞书告警 API 调用 | 实际 HTTP POST 到飞书 Webhook URL | 需配置真实 Webhook 后手动触发 82% 场景验收 |
| 6 | Bark 推送 API 调用 | 实际 HTTP POST 到 Bark 服务 | 需 Bark key 配置后手动触发 91% 场景验收 |
| 7 | `fs.readdir`（枚举 worktrees 目录） | 实际扫描宿主机文件系统，依赖目录权限 | E2E Step 6 创建真实目录验收 |

---

## Test Contract

| WS | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `../../packages/brain/src/cron/disk-guard.test.js` | BEHAVIOR-1 / BEHAVIOR-2 / BEHAVIOR-3 / BEHAVIOR-4 / BEHAVIOR-8 / BEHAVIOR-9 / BEHAVIOR-10 | Red commit 0041a79d3 测试套件失败（7 个新测试 FAIL） |
| WS2 | `../../packages/brain/src/cron/worktree-reaper.test.js` | BEHAVIOR-5 / BEHAVIOR-6 / BEHAVIOR-7 | Red commit 0041a79d3 测试套件失败（5 个新测试 FAIL） |

## 架构决策记录

| 决策 | 原因 |
|------|------|
| disk-guard 为独立文件 `cron/disk-guard.js`（非内联 scheduler-jobs） | 便于测试 import 隔离，不污染 scheduler-jobs 主文件 |
| worktree-reaper 在 `cron/worktree-reaper.js`，通过 janitor.js REGISTRY 引用 | janitor.js 框架已存在，遵循既有扩展点 |
| 节流 gate 用模块级 `lastRunAt` 变量 | 与 launchd-patrol.js 保持一致的模式（参考实现） |
| fail-open 策略：查不到 task 记录 → 不删 | 防第 6 次误杀；宁可磁盘多占，不可误删活跃工作区 |
| 清理序列各步骤独立 try/catch | NFR-可靠性：单步失败不影响后续步骤 |
