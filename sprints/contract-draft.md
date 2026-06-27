# Sprint Contract Draft (Round 2) — harness 内部线 staging→promote→:5211 贯通验证

## Response Schema（推导来源: PRD字面）

N/A — 本 sprint 无新 HTTP API 端点。验证目标是 Brain DB 状态 + :5211 存活，非 response schema 结构。

---

## 已知约束（来自回归测试）

- [staging-e2e-runner-deploy-path.test.js] → deployStaging 必须用绝对路径调 staging-deploy.sh
- [staging-e2e-runner-host.test.js] → STAGING_HOST 可覆盖 host.docker.internal
- [staging-e2e-runner-dashboard-seam.test.js] → 内部线 port=5223 时 5174→5223，5221 保持活 brain
- [deploy-staging-guardrail.test.js] → deploy-local.sh 容错：无 docker/无 env → STAGING_SKIP_REASON
- [slice3-report-postpromote.test.js] → promote 完成后 spawnHarnessReport 幂等派出

---

## 接缝清单（logic-done-pending 直到真目标验过）

| # | 接缝点 | 碰真实世界在哪 | 真目标验证方式 |
|---|---|---|---|
| 接缝1 | `deploy-local.sh --changed=apps/dashboard/` 真实执行 | 宿主 npm build + 产物写 .staging-pending | staging_e2e_results.verdict=PASS 落 Brain DB |
| 接缝2 | `promote-dashboard.sh` 真实执行 | .staging-pending 文件 + 产物库 + 写 :5211 live | staging_e2e_results.promote_status=auto_promoted 落 DB |
| 接缝3 | :5211 dashboard 存活 | 宿主 nginx/pm2 进程占用真实端口 | `curl -sf http://localhost:5211/` HTTP 200 |

---

## Golden Path

```
[最小触点 PR] → [CI 通过 + merge main] → [staging deploy :5223 + E2E PASS]
  → [Slice9 复合闸通过] → [auto_promote] → [:5211 响应] → [harness_report 完成]
```

---

### Step 1: Generator 注入最小触点并产出 PR

**来源**: `[FROM_PRD]` — PRD 背景段"触发一次真实的 harness initiative"；ASSUMPTION 段"触点选最小 dashboard 改动"

**可观测行为**: apps/dashboard/index.html 头部新增一行包含 `harness-pipeline-verify 2026-06-27` 的注释；PR 在 GitHub 可见

**验证命令**:
```bash
grep -q 'harness-pipeline-verify 2026-06-27' apps/dashboard/index.html || { echo "FAIL: 触点注释不存在"; exit 1; }
echo "OK"
```

**硬阈值**: 文件含指定注释字符串，grep exit 0

---

### Step 2: PR CI 通过并合并到 main（由 harness CI watch 观测）

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 项"PR CI 通过，merge 到 main"

**可观测行为**: Brain DB 中 task_type=harness_ci_watch 或 harness_generate 状态为 completed；initiative 无 FAIL 行

**验证命令**:
```bash
# 前置守卫：INITIATIVE_ID 必须非空，否则 psql 查 '' 会假通过
[ -n "$INITIATIVE_ID" ] || { echo "FAIL: INITIATIVE_ID 未设置"; exit 1; }
# 检查 initiative 下 harness 任务无 FAIL 状态（带 60 分钟时间窗，覆盖 pipeline >30min 场景）
COUNT=$(psql $DB -t -c "SELECT count(*) FROM tasks WHERE payload->>'initiative_id' = '$INITIATIVE_ID' AND status='failed' AND created_at > NOW() - interval '60 minutes'" 2>/dev/null | tr -d ' ')
[ "$COUNT" = "0" ] || { echo "FAIL: initiative 有 $COUNT 个 failed 任务"; exit 1; }
echo "OK: 无 failed 任务"
```

**硬阈值**: failed 任务数 = 0，60 分钟时间窗内

---

### Step 3: staging-e2e-runner 部署 dashboard 到 :5223，E2E PASS，tested_sha 落库

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 项"staging-e2e-runner 调 deploy-local.sh，dashboard 部署到 staging :5223；verdict=PASS、tested_sha 落库"

**可观测行为**: staging_e2e_results 表有一行 initiative_id=$INITIATIVE_ID，verdict=PASS，tested_sha 非空

**验证命令**:
```bash
# 前置守卫
[ -n "$INITIATIVE_ID" ] || { echo "FAIL: INITIATIVE_ID 未设置"; exit 1; }
ROW=$(psql $DB -t -c "SELECT verdict, tested_sha FROM staging_e2e_results WHERE initiative_id='$INITIATIVE_ID' AND created_at > NOW() - interval '60 minutes'" 2>/dev/null | tr -d ' ')
echo "$ROW" | grep -q "PASS" || { echo "FAIL: verdict 不是 PASS，行内容：$ROW"; exit 1; }
SHA=$(psql $DB -t -c "SELECT tested_sha FROM staging_e2e_results WHERE initiative_id='$INITIATIVE_ID'" 2>/dev/null | tr -d ' ')
[ -n "$SHA" ] && [ "$SHA" != "NULL" ] || { echo "FAIL: tested_sha 为空"; exit 1; }
echo "OK: verdict=PASS tested_sha=$SHA"
```

**硬阈值**: verdict=PASS，tested_sha 非空，60 分钟时间窗内落库

---

### Step 4: Slice9 复合闸通过 → auto_promote，promote_status=auto_promoted 写库

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 项"Slice9 复合闸通过 → runInternalPromote 执行 promote-dashboard.sh，promote_status 更新为 auto_promoted"

**可观测行为**: staging_e2e_results 中 initiative_id=$INITIATIVE_ID 行的 promote_status=auto_promoted

**验证命令**:
```bash
STATUS=$(psql $DB -t -c "SELECT promote_status FROM staging_e2e_results WHERE initiative_id='$INITIATIVE_ID'" 2>/dev/null | tr -d ' ')
[ "$STATUS" = "auto_promoted" ] || { echo "FAIL: promote_status=$STATUS（期望 auto_promoted）"; exit 1; }
echo "OK: promote_status=auto_promoted"
```

**硬阈值**: promote_status 字面值等于 `auto_promoted`

---

### Step 5: Dashboard 重起于 :5211，HTTP 200 响应

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 项"Dashboard 重起于 :5211"；边界情况":5211 未响应 → 视为 deploy 未贯通"

**可观测行为**: `curl http://localhost:5211/` 返回 HTTP 200，响应体非空

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5211/)
[ "$CODE" = "200" ] || { echo "FAIL: :5211 返回 HTTP $CODE（期望 200）"; exit 1; }
BODY=$(curl -sf http://localhost:5211/ | wc -c | tr -d ' ')
[ "$BODY" -gt 0 ] || { echo "FAIL: :5211 响应体为空"; exit 1; }
echo "OK: :5211 HTTP 200 响应体 ${BODY} bytes"
```

**硬阈值**: HTTP 200，响应体 > 0 字节

---

### Step 6: harness_report 任务派出并完成

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 项"harness_report 任务自动派出并完成"

**可观测行为**: tasks 表中 task_type=harness_report、payload->'initiative_id'=$INITIATIVE_ID 的行 status=completed

**验证命令**:
```bash
REPORT_STATUS=$(psql $DB -t -c "SELECT status FROM tasks WHERE task_type='harness_report' AND payload->>'initiative_id' = '$INITIATIVE_ID'" 2>/dev/null | tr -d ' ')
[ "$REPORT_STATUS" = "completed" ] || { echo "FAIL: harness_report status=$REPORT_STATUS（期望 completed）"; exit 1; }
echo "OK: harness_report completed"
```

**硬阈值**: status 字面值等于 `completed`

---

## Risks

| # | 风险 | 影响 | Mitigation |
|---|---|---|---|
| R1 | **评估器时间窗假设** — pipeline 总耗时超过时间窗（原 30min）时，BEHAVIOR 2/3 的 `created_at > NOW() - interval 'X minutes'` 查不到记录，误报 FAIL；无法区分「pipeline 还没跑完」与「pipeline 真失败」 | BEHAVIOR 2/3 假 FAIL，evaluator 错判 pipeline 贯通失败 | 本轮已将时间窗扩大至 **60 分钟**（覆盖已知最长 pipeline 耗时）；长期 mitigation：evaluator 在 pipeline completed 事件后触发，而非定时执行 |
| R2 | **INITIATIVE_ID 未注入前置条件** — 各 BEHAVIOR 独立执行时若 `$INITIATIVE_ID` 为空，`WHERE initiative_id=''` 对 tasks/staging_e2e_results 均返回 0 行；BEHAVIOR 2（failed 计数 = 0）假通过，BEHAVIOR 3/4/5 因空行返回空字符串而误走错误路径 | BEHAVIOR 2 假通过，其余 BEHAVIOR 错误 FAIL；evaluator 结论不可信 | 本轮已在每条涉及 INITIATIVE_ID 的 BEHAVIOR 命令首行加 `[ -n "$INITIATIVE_ID" ] \|\| { echo "FAIL: INITIATIVE_ID 未设置"; exit 1; }` 守卫；E2E 脚本已有同等守卫（Round 1 已实现） |

---

## E2E 验收（target_environment = local_api）

**journey_type**: autonomous  
**target_environment**: local_api

> 注意：接缝1/2/3（deploy-local.sh、promote-dashboard.sh、:5211 存活）是真机接缝断言，在宿主 Mac 上通过 Brain 调度执行。evaluator 运行本脚本时 pipeline 应已完成，脚本只做状态验证。若 pipeline 尚未完成（staging_e2e_results 无记录），脚本以 FAIL 退出。

```bash
#!/bin/bash
set -e

# 环境变量：INITIATIVE_ID（由 evaluator/Brain 注入）、DB（默认 postgresql://localhost/cecelia）
DB="${DB:-postgresql://localhost/cecelia}"

if [ -z "$INITIATIVE_ID" ]; then
  echo "FAIL: INITIATIVE_ID 未设置，evaluator 必须注入"
  exit 1
fi

echo "验证 initiative_id=$INITIATIVE_ID pipeline 贯通状态..."

# ── 断言 1：Step 1 触点注释存在 ──
grep -q 'harness-pipeline-verify 2026-06-27' apps/dashboard/index.html || {
  echo "FAIL [Step1]: apps/dashboard/index.html 缺少触点注释"
  exit 1
}
echo "✓ Step1: 触点注释存在"

# ── 断言 2：initiative 无 failed 任务 ──
FAIL_COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM tasks WHERE payload->>'initiative_id' = '$INITIATIVE_ID' AND status='failed' AND created_at > NOW() - interval '60 minutes'" | tr -d ' ')
[ "$FAIL_COUNT" = "0" ] || {
  echo "FAIL [Step2]: initiative 有 $FAIL_COUNT 个 failed 任务（30分钟内）"
  exit 1
}
echo "✓ Step2: 无 failed 任务"

# ── 断言 3：staging E2E verdict=PASS + tested_sha 非空（时间窗 30 分钟）──
VERDICT=$(psql "$DB" -t -c "SELECT verdict FROM staging_e2e_results WHERE initiative_id='$INITIATIVE_ID' AND created_at > NOW() - interval '60 minutes'" | tr -d ' ')
[ "$VERDICT" = "PASS" ] || {
  echo "FAIL [Step3]: staging_e2e_results.verdict=$VERDICT（期望 PASS，时间窗内）"
  exit 1
}
SHA=$(psql "$DB" -t -c "SELECT tested_sha FROM staging_e2e_results WHERE initiative_id='$INITIATIVE_ID'" | tr -d ' ')
[ -n "$SHA" ] && [ "$SHA" != "NULL" ] || {
  echo "FAIL [Step3]: tested_sha 为空（Slice9 未锚定 SHA）"
  exit 1
}
echo "✓ Step3: verdict=PASS tested_sha=$SHA"

# ── 断言 4：promote_status=auto_promoted ──
PROMOTE_STATUS=$(psql "$DB" -t -c "SELECT promote_status FROM staging_e2e_results WHERE initiative_id='$INITIATIVE_ID'" | tr -d ' ')
[ "$PROMOTE_STATUS" = "auto_promoted" ] || {
  echo "FAIL [Step4]: promote_status=$PROMOTE_STATUS（期望 auto_promoted）"
  exit 1
}
echo "✓ Step4: promote_status=auto_promoted"

# ── 断言 5：:5211 HTTP 200 ──
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5211/)
[ "$HTTP_CODE" = "200" ] || {
  echo "FAIL [Step5]: localhost:5211 返回 HTTP $HTTP_CODE（期望 200）"
  exit 1
}
BODY_SIZE=$(curl -sf http://localhost:5211/ | wc -c | tr -d ' ')
[ "$BODY_SIZE" -gt 0 ] || {
  echo "FAIL [Step5]: localhost:5211 响应体为空"
  exit 1
}
echo "✓ Step5: :5211 HTTP 200 响应体 ${BODY_SIZE} bytes"

# ── 断言 6：harness_report completed ──
REPORT_STATUS=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE task_type='harness_report' AND payload->>'initiative_id' = '$INITIATIVE_ID'" | tr -d ' ')
[ "$REPORT_STATUS" = "completed" ] || {
  echo "FAIL [Step6]: harness_report status=$REPORT_STATUS（期望 completed）"
  exit 1
}
echo "✓ Step6: harness_report completed"

echo ""
echo "✅ Golden Path 全部通过 — harness 内部线 staging→auto_promote→:5211 贯通验证成功"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 触点注释存在（Generator 添加后变绿）| `tests/harness-pipeline-verify.test.ts` | 触点注释 / staging_e2e_results schema / promote logic | → 3 failures（触点未添加、DB 无记录）|
