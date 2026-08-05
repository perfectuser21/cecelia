# 工厂 GP 八条最薄 smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** F0~F7 八条最薄 smoke 进棘轮 + F2 钉子逼出 sidecar drain-cancel 修复（53e7ee4b 根治①）。

**Architecture:** 统一模板（诚实声明+FIRE_TEST 自炸口+ok/fail 计数）×8，断言表来自 spec；allowlist 登记；sidecar 在 healthz 通过后补 drain-cancel 轮询。

**Tech Stack:** bash、psql（PG* env）、curl、node -e。

## Global Constraints

- 工作目录：`/Users/administrator/worktrees/cecelia/factory-gp-smokes-thin`（基 b3702cc3b6）
- TDD：commit-1 = 8 smoke + allowlist（F2 红实弹）；commit-2 = sidecar 修复（F2 绿）
- 脚本目录必须 `packages/brain/scripts/smoke/`；断言禁 jq（用 node -e / grep / psql -tAc）
- 环境变量：`BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"`；psql 一律走 `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` 已导出的 CI 约定，本地跑时用 `PGHOST=localhost PGPORT=5432 PGUSER=postgres PGDATABASE=cecelia` 前缀（脚本内不硬编码库名）
- 每脚本头部诚实声明必须写：结构级断言不代表运行时行为已验证；tick=false 环境不断言调度真执行
- 注释/输出简体中文；commit message 结尾 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: 8 个 smoke + allowlist（commit-1，F2 红实弹）

**Files:**
- Create: `packages/brain/scripts/smoke/factory-f{0..7}-*-smoke.sh` ×8（chmod +x）
- Modify: `packages/quality/smoke-allowlist.txt`（8 行，插入字母序位置）

- [ ] **Step 1: 统一模板（每个脚本照此骨架）**

```bash
#!/usr/bin/env bash
# factory-fN-<slug>-smoke.sh — 工厂 GP 五件套第一刀：F<N> <名称> 最薄守卫
#
# ⚠️ 诚实声明（假绿灯纪律）：本闸为结构/契约级为主 + 少量运行时断言的最薄层。
#   - [结构] 断言只证明代码/注册表形态存在，不代表运行时行为已验证
#   - CI 环境 CECELIA_TICK_ENABLED=false：不断言任何"调度已真实执行"
#   - 决策 2a8bf656：工厂 journey 的 mvp 标签自此开始有机器背书，加厚走后续刀
# FIRE_TEST=1 为开发期自炸口（proven-to-fire 验证守卫非恒真），CI 不设。
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }
psql_q() { psql -qtAc "$1"; }

# ...断言若干（见各脚本断言块）...

if [ "${FIRE_TEST:-0}" = "1" ]; then
  fail "FIRE_TEST 自炸（proven-to-fire 验证口）"
fi

echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
```

- [ ] **Step 2: 全工例——factory-f4-selfheal-smoke.sh 完整断言块（其余七条照此密度组装）**

```bash
echo "== F4 故障自愈：liveness 合同层 =="
node -e '
import("./packages/brain/src/executor-contracts.js").then(m => {
  if (!Array.isArray(m.VALID_EXECUTOR_KINDS) || m.VALID_EXECUTOR_KINDS.length !== 7)
    { console.error("VALID_EXECUTOR_KINDS 应为 7 kind，实际 " + m.VALID_EXECUTOR_KINDS.length); process.exit(1); }
  for (const k of m.VALID_EXECUTOR_KINDS) {
    const c = m.EXECUTOR_CONTRACTS[k];
    if (!c || typeof c.probe !== "function") { console.error("kind 缺 probe: " + k); process.exit(1); }
  }
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); })
' && ok "executor-contracts 七 kind 各有 probe（进程级导入）" || fail "executor-contracts 结构断言失败"

node -e '
import("./packages/brain/src/lib/codex-review-liveness.js").then(m => {
  if (typeof m.probeCodexReviewLock !== "function" || !m.CODEX_REVIEW_LOCK_DIR) process.exit(1);
  process.exit(0);
}).catch(() => process.exit(1))
' && ok "codex-review-liveness SSOT 导出完整" || fail "codex-review-liveness SSOT 缺失"

grep -q "codex-review-liveness" packages/brain/src/executor-contracts.js \
  && ok "合同层引用 lock SSOT" || fail "合同层未引用 lock SSOT"

[ "$(psql_q "SELECT to_regclass('circuit_breaker_states') IS NOT NULL")" = "t" ] \
  && ok "[运行时] circuit_breaker_states 表存在" || fail "circuit_breaker_states 表缺失"

curl -fsm 10 "$BRAIN_URL/api/brain/health" | node -e '
let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{ const j=JSON.parse(d); process.exit(j.organs?0:1); })
' && ok "[运行时] /health 200 且含 organs" || fail "/health 断言失败"

grep -q "requeueTask" packages/brain/src/executor.js \
  && ok "executor 含 requeueTask（回队出路）" || fail "requeueTask 缺失"
```

- [ ] **Step 3: 其余七条的断言命令清单（每行=脚本里一个 ok/fail 断言，级别标注进 ok 文案）**

**factory-f0-proposal-smoke.sh**
```bash
[ "$(psql_q "SELECT to_regclass('golden_paths') IS NOT NULL")" = "t" ]
psql_q "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='golden_paths'::regclass AND contype='c'" | grep -q "candidate"   # status 生命周期
[ "$(psql_q "SELECT count(*) FROM information_schema.columns WHERE table_name='golden_path' AND column_name='owner_task_id'")" = "1" ]
curl -fsm 10 "$BRAIN_URL/api/brain/golden-paths" >/dev/null
curl -fsm 10 "$BRAIN_URL/api/brain/decisions?limit=1" >/dev/null
grep -q "'/approve'\|/approve" packages/brain/src/routes/golden-paths.js && grep -q "/veto" packages/brain/src/routes/golden-paths.js
grep -q "golden_path_proposal" packages/brain/src/executor.js
```

**factory-f1-devloop-smoke.sh**
```bash
node -e 'import("./packages/brain/src/lib/review-task-types.js").then(m=>{const a=m.REVIEW_TASK_TYPES;process.exit(Array.isArray(a)&&a.includes("code_review")&&a.includes("arch_review")?0:1)}).catch(()=>process.exit(1))'
for f in packages/brain/src/executor.js packages/brain/src/callback-processor.js packages/brain/src/routes/execution.js; do grep -q "review-task-types" "$f" || exit 1; done   # SSOT 三处引用（防复制漂移）
[ "$(psql_q "SELECT to_regclass('dispatch_events') IS NOT NULL")" = "t" ]
grep -q "triggerCodexReview" packages/brain/src/executor.js && grep -q "requeueTask" packages/brain/src/executor.js
```

**factory-f2-deploy-smoke.sh**（钉子脚本，commit-1 必红）
```bash
grep -q "drain-cancel" scripts/lib/bluegreen-sidecar.sh   # ← 53e7ee4b 钉子：sidecar 是 blue 被删后唯一活路径，必须由它收 drain（当前 0 处=红）
grep -q "drain_before_swap" scripts/brain-deploy.sh && grep -q "drain_cancel_with_retry" scripts/brain-deploy.sh
# [运行时] drain 开关幂等回路（先例 smoke-runtime.sh:138-168）：
curl -fsm 5 -X POST "$BRAIN_URL/api/brain/tick/drain" >/dev/null
curl -fsm 5 "$BRAIN_URL/api/brain/tick/drain-status" | grep -q '"draining":true'
curl -fsm 5 -X POST "$BRAIN_URL/api/brain/tick/drain-cancel" >/dev/null
curl -fsm 5 "$BRAIN_URL/api/brain/tick/drain-status" | grep -q '"draining":false'
grep -q "DRAIN_RESTORE_MAX_AGE_MS" packages/brain/src/drain.js
[ -f scripts/smoke/e2e/deploy-daily-drill.sh ]
```

**factory-f3-nightly-smoke.sh**
```bash
grep -q "arch-review" packages/brain/src/scheduler-jobs.js && grep -q "ci-patrol" packages/brain/src/scheduler-jobs.js
grep -q "startSchedulerJobsLoop" packages/brain/src/server.js
grep -q "arch_review" packages/brain/src/daily-review-scheduler.js && grep -q "ci_patrol" packages/brain/src/daily-review-scheduler.js
grep -q "line-strategist-dispatch" packages/brain/src/tick-runner.js
```

**factory-f5-cockpit-smoke.sh**
```bash
curl -fsm 10 "$BRAIN_URL/api/brain/health" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);process.exit(j.organs&&j.organs.scheduler&&j.organs.circuit_breaker?0:1)})'
curl -fsm 10 "$BRAIN_URL/api/brain/healthz" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);process.exit(["ok","degraded","critical"].includes(j.status)?0:1)})'
```

**factory-f6-inbox-smoke.sh**
```bash
[ "$(psql_q "SELECT to_regclass('capture_atoms') IS NOT NULL")" = "t" ] && [ "$(psql_q "SELECT to_regclass('captures') IS NOT NULL")" = "t" ]
curl -fsm 10 "$BRAIN_URL/api/brain/capture-atoms" >/dev/null
for j in capture-triage triage-officer-rank triage-officer-15min; do grep -q "$j" packages/brain/src/scheduler-jobs.js || exit 1; done
```

**factory-f7-memory-smoke.sh**
```bash
[ "$(psql_q "SELECT to_regclass('working_memory') IS NOT NULL")" = "t" ] && [ "$(psql_q "SELECT to_regclass('memory_stream') IS NOT NULL")" = "t" ]
grep -q "runNotionPushSync" packages/brain/src/notion-push-sync.js && grep -q "buildDecisionNotionProperties" packages/brain/src/notion-push-sync.js
```

组装要求：每条命令包进 `if ...; then ok "..."; else fail "..."; fi`（`set -e` 下禁止裸 `cmd && ok || fail` 以外的形态——统一用模板 `cmd && ok || fail` 是安全的因为整体表达式恒真，但**禁止让 fail 后 exit 提前**，计数完统一在结尾判）。实现前先逐条在仓里验证 grep 目标真实存在（研究员给过行号，若有漂移以现状调整 grep 词但不得放宽语义）。

- [ ] **Step 4: allowlist 登记**

`packages/quality/smoke-allowlist.txt` 按既有排序规则插入 8 行文件名（先 `head` 看排序规律）。

- [ ] **Step 5: 本地实跑（红绿实弹记录）**

```bash
cd /Users/administrator/worktrees/cecelia/factory-gp-smokes-thin
for s in packages/brain/scripts/smoke/factory-f*-smoke.sh; do echo "== $s =="; PGHOST=localhost PGPORT=5432 PGUSER=postgres PGDATABASE=cecelia bash "$s"; echo "exit=$?"; done
```
Expected：F0/F1/F3/F4/F5/F6/F7 七条 exit 0；**F2 exit 1 且红在 sidecar drain-cancel 钉子断言**（其余断言绿）——这是 proven-to-fire 实弹，输出记报告。
再逐条 `FIRE_TEST=1 bash <脚本>` 确认全部自炸红（各 exit 1）。

- [ ] **Step 6: Commit（commit-1）**

```bash
git add packages/brain/scripts/smoke/factory-f*-smoke.sh packages/quality/smoke-allowlist.txt
git commit -m "feat(factory): F0~F7 八条最薄 GP smoke 进棘轮（F2 钉子红实弹）"
```

---

### Task 2: sidecar drain-cancel 修复（commit-2，F2 转绿）

**Files:**
- Modify: `scripts/lib/bluegreen-sidecar.sh`

- [ ] **Step 1: 读现状定插入点**

读全文：确认 compose up 与新 Brain 健康等待的位置、脚本可用的 BRAIN_URL/端口变量名、日志函数写法。插入点=新实例 healthz 确认之后。

- [ ] **Step 2: 追加 drain-cancel 轮询（照脚本既有日志风格适配变量名）**

```bash
# ── drain 收尾（issue 53e7ee4b 根治①）─────────────────────────────
# 部署型 drain 由 brain-deploy.sh pre-swap 挂上；Docker 蓝绿下 deploy 进程随 blue
# 容器被 docker rm -f 截断，其 :520 的 drain_cancel_with_retry 永远够不着——
# sidecar 是 swap 后唯一存活路径，必须由这里收 drain。cancel 失败不 fail 部署
# （15min 过期闸与 getDrainStatus 归零是下层兜底），但必须红日志留痕。
DRAIN_CANCEL_OK=0
for i in 1 2 3 4 5; do
  if curl -fsm 5 -X POST "${BRAIN_URL}/api/brain/tick/drain-cancel" >/dev/null 2>&1; then
    echo "[sidecar] drain-cancel 成功（第 ${i} 次尝试）"
    DRAIN_CANCEL_OK=1; break
  fi
  echo "[sidecar] drain-cancel 第 ${i} 次失败，5s 后重试"
  sleep 5
done
[ "$DRAIN_CANCEL_OK" = "1" ] || echo "[sidecar] ❌ drain-cancel 5 次全失败——依赖 15min 过期闸兜底，请检查（issue 53e7ee4b）"
```

- [ ] **Step 3: 验证**

```bash
bash -n scripts/lib/bluegreen-sidecar.sh
PGHOST=localhost PGPORT=5432 PGUSER=postgres PGDATABASE=cecelia bash packages/brain/scripts/smoke/factory-f2-deploy-smoke.sh   # 期望 exit 0
for s in packages/brain/scripts/smoke/factory-f*-smoke.sh; do PGHOST=localhost PGPORT=5432 PGUSER=postgres PGDATABASE=cecelia bash "$s" >/dev/null || echo "RED: $s"; done   # 期望零 RED
```

- [ ] **Step 4: Commit（commit-2）**

```bash
git add scripts/lib/bluegreen-sidecar.sh
git commit -m "fix(deploy): sidecar 补 drain-cancel——部署型 drain 亡灵根治（53e7ee4b①，F2 钉子转绿）"
```
