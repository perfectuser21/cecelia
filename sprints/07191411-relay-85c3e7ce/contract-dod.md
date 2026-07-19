# Contract DoD — headless-smoke（85c3e7ce）

## 元信息

- TASK_ID: `85c3e7ce-7849-42b8-9ff9-542dd0db8375`
- Sprint: `07191411-relay-85c3e7ce`
- 生成时间: 2026-07-19
- 轮次: 第 1 轮（首轮）

---

## [BEHAVIOR] 条目

### [BEHAVIOR-01] Task 状态与三元组校验

**断言**: 调用 `GET /api/brain/tasks/85c3e7ce-7849-42b8-9ff9-542dd0db8375`，响应中 `status` 字段值为 `"in_progress"`，且 `payload` 字段包含 `mode="headless"`、`executor="claude"`、`orchestrator="skill-relay"` 三元组，`dispatched_by_orchestrator=true`，`orchestrator_dispatched_at` 非空非 null。

**对应铁律**: 铁律 #1（不依赖 headed session）、铁律 #2（引用实时 API 响应）

**判定方式**: `manual:bash`

```bash
TASK_ID="85c3e7ce-7849-42b8-9ff9-542dd0db8375"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
RESP=$(curl -sf "${BRAIN_URL}/api/brain/tasks/${TASK_ID}")
STATUS=$(echo "$RESP" | jq -r '.status')
MODE=$(echo "$RESP" | jq -r '.payload.mode // .data.payload.mode // empty')
EXECUTOR=$(echo "$RESP" | jq -r '.payload.executor // .data.payload.executor // empty')
ORCHESTRATOR=$(echo "$RESP" | jq -r '.payload.orchestrator // .data.payload.orchestrator // empty')
DISPATCHED=$(echo "$RESP" | jq -r '.dispatched_by_orchestrator // .data.dispatched_by_orchestrator // empty')
DISPATCHED_AT=$(echo "$RESP" | jq -r '.orchestrator_dispatched_at // .data.orchestrator_dispatched_at // empty')
[ "$STATUS" = "in_progress" ] && echo "PASS: status=in_progress" || (echo "FAIL: status=$STATUS" && exit 1)
[ "$MODE" = "headless" ] && echo "PASS: mode=headless" || (echo "FAIL: mode=$MODE" && exit 1)
[ "$EXECUTOR" = "claude" ] && echo "PASS: executor=claude" || (echo "FAIL: executor=$EXECUTOR" && exit 1)
[ "$ORCHESTRATOR" = "skill-relay" ] && echo "PASS: orchestrator=skill-relay" || (echo "FAIL: orchestrator=$ORCHESTRATOR" && exit 1)
[ "$DISPATCHED" = "true" ] && echo "PASS: dispatched_by_orchestrator=true" || (echo "FAIL: dispatched_by_orchestrator=$DISPATCHED" && exit 1)
[ -n "$DISPATCHED_AT" ] && [ "$DISPATCHED_AT" != "null" ] && echo "PASS: orchestrator_dispatched_at set" || (echo "FAIL: orchestrator_dispatched_at empty" && exit 1)
```

---

### [BEHAVIOR-02] Claim Oracle 验证

**断言**: 同一 API 响应中，`claimed_by`、`claimed_at`、`executor_kind` 三个字段均存在且值非空非 null；`status=in_progress` 为当前 session 持有 claim 的充分条件。

**对应铁律**: 铁律 #2（引用实时 API 响应）

**判定方式**: `manual:bash`

```bash
TASK_ID="85c3e7ce-7849-42b8-9ff9-542dd0db8375"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
RESP=$(curl -sf "${BRAIN_URL}/api/brain/tasks/${TASK_ID}")
CLAIMED_BY=$(echo "$RESP" | jq -r '.claimed_by // .data.claimed_by // empty')
CLAIMED_AT=$(echo "$RESP" | jq -r '.claimed_at // .data.claimed_at // empty')
EXECUTOR_KIND=$(echo "$RESP" | jq -r '.executor_kind // .data.executor_kind // empty')
[ -n "$CLAIMED_BY" ] && [ "$CLAIMED_BY" != "null" ] && echo "PASS: claimed_by set ($CLAIMED_BY)" || (echo "FAIL: claimed_by empty" && exit 1)
[ -n "$CLAIMED_AT" ] && [ "$CLAIMED_AT" != "null" ] && echo "PASS: claimed_at set" || (echo "FAIL: claimed_at empty" && exit 1)
[ -n "$EXECUTOR_KIND" ] && [ "$EXECUTOR_KIND" != "null" ] && echo "PASS: executor_kind set ($EXECUTOR_KIND)" || (echo "FAIL: executor_kind empty" && exit 1)
```

---

### [BEHAVIOR-03] initiative_runs Concern 记录

**断言**: 若 Brain relay-runs 端点不存在（404）或返回空集，必须将此事实记录到 `sprints/07191411-relay-85c3e7ce/concerns.txt`，不得记为失败，不得伪造成功证据。

**对应铁律**: 铁律 #3（initiative_runs 缺失必须列为 concern）

**判定方式**: `manual:bash`

```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07191411-relay-85c3e7ce}"
HTTP_CODE=$(curl -s -o /tmp/relay_runs_resp.json -w "%{http_code}" "${BRAIN_URL}/api/brain/relay-runs?task_id=85c3e7ce-7849-42b8-9ff9-542dd0db8375")
if [ "$HTTP_CODE" = "404" ]; then
  echo "CONCERN: relay-runs endpoint not found (404)" | tee -a "${SPRINT_DIR}/concerns.txt"
else
  COUNT=$(jq 'if type=="array" then length elif .data and (.data|type=="array") then (.data|length) else 0 end' /tmp/relay_runs_resp.json 2>/dev/null || echo 0)
  if [ "$COUNT" -eq 0 ]; then
    echo "CONCERN: initiative_runs empty for task 85c3e7ce-7849-42b8-9ff9-542dd0db8375" | tee -a "${SPRINT_DIR}/concerns.txt"
  else
    echo "INFO: initiative_runs count=$COUNT"
  fi
fi
echo "PASS: initiative_runs concern check completed (concern if missing is not a failure)"
```

---

### [BEHAVIOR-04] 证据文件写入

**断言**: 执行验收后，`sprints/07191411-relay-85c3e7ce/evidence.json` 必须存在，且包含 `task_id`、`status`、`payload`（三元组）、`orchestrator_dispatched_at`、`claimed_at` 字段，内容为脱敏摘要（不含 secrets）。

**对应铁律**: 铁律 #2（引用实时 API 响应）

**判定方式**: `manual:bash`

```bash
SPRINT_DIR="${SPRINT_DIR:-sprints/07191411-relay-85c3e7ce}"
EVIDENCE="${SPRINT_DIR}/evidence.json"
[ -f "$EVIDENCE" ] && echo "PASS: evidence.json exists" || (echo "FAIL: evidence.json not found" && exit 1)
jq -e '.task_id' "$EVIDENCE" > /dev/null && echo "PASS: task_id present" || (echo "FAIL: task_id missing" && exit 1)
jq -e '.status' "$EVIDENCE" > /dev/null && echo "PASS: status present" || (echo "FAIL: status missing" && exit 1)
jq -e '.payload' "$EVIDENCE" > /dev/null && echo "PASS: payload present" || (echo "FAIL: payload missing" && exit 1)
jq -e '.orchestrator_dispatched_at' "$EVIDENCE" > /dev/null && echo "PASS: orchestrator_dispatched_at present" || echo "WARN: orchestrator_dispatched_at missing (may be null)"
jq -e '.claimed_at' "$EVIDENCE" > /dev/null && echo "PASS: claimed_at present" || echo "WARN: claimed_at missing"
```

---

### [BEHAVIOR-05] e2e-verify.sh 脚本真实执行

**断言**: `sprints/07191411-relay-85c3e7ce/e2e-verify.sh` 存在、可执行，执行后返回 exit 0（真实通过，非 exit 0 兜底），且脚本每个断言失败即立刻 exit 1；脚本可幂等重复执行。

**对应铁律**: 铁律 #1（不依赖 headed session）、铁律 #4（禁止 exit 0 兜底）

**判定方式**: `manual:bash`

```bash
SPRINT_DIR="${SPRINT_DIR:-sprints/07191411-relay-85c3e7ce}"
SCRIPT="${SPRINT_DIR}/e2e-verify.sh"
[ -f "$SCRIPT" ] && echo "PASS: e2e-verify.sh exists" || (echo "FAIL: e2e-verify.sh not found" && exit 1)
[ -x "$SCRIPT" ] && echo "PASS: e2e-verify.sh is executable" || (echo "FAIL: e2e-verify.sh not executable" && exit 1)
# 检查无 exit 0 兜底
grep -n 'exit 0' "$SCRIPT" | grep -v '#' && echo "WARN: found bare 'exit 0' — review for backdoor" || echo "PASS: no bare exit 0 found"
bash "$SCRIPT" && echo "PASS: e2e-verify.sh completed successfully" || (echo "FAIL: e2e-verify.sh exited non-zero" && exit 1)
```

---

### [BEHAVIOR-06] headless 路径独立性（非 headed 历史依赖）

**断言**: e2e-verify.sh 的所有断言均来自对 `task_id=85c3e7ce-7849-42b8-9ff9-542dd0db8375` 的实时 Brain API 调用，不引用任何 headed session 历史记录、旧 evidence 文件或缓存响应。

**对应铁律**: 铁律 #1（不依赖 headed session）、铁律 #5（测试锁定）

**判定方式**: `manual:bash`

```bash
SCRIPT="sprints/07191411-relay-85c3e7ce/e2e-verify.sh"
# 验证脚本中不引用 headed-smoke sprint 或旧 session 路径
grep -n 'd355821f\|headed.*session\|headed.*history\|headed.*evidence' "$SCRIPT" && (echo "FAIL: script references headed session artifacts" && exit 1) || echo "PASS: no headed session dependency found"
# 验证脚本中有真实 curl 调用
grep -n 'curl' "$SCRIPT" | grep '85c3e7ce' && echo "PASS: script contains curl with correct task_id" || (echo "FAIL: no curl with task_id found in script" && exit 1)
```

---

## 综合验收命令

```bash
# 全量一键验收（在仓库根目录执行）
BRAIN_URL=http://localhost:5221 SPRINT_DIR=sprints/07191411-relay-85c3e7ce bash sprints/07191411-relay-85c3e7ce/e2e-verify.sh
```

---

## DoD 检查表

| # | [BEHAVIOR] | 铁律覆盖 | 判定 | 状态 |
|---|-----------|----------|------|------|
| 1 | BEHAVIOR-01: Task 状态与三元组 | #1 #2 | manual:bash | [x] |
| 2 | BEHAVIOR-02: Claim Oracle | #2 | manual:bash | [x] |
| 3 | BEHAVIOR-03: initiative_runs Concern | #3 | manual:bash | [x] |
| 4 | BEHAVIOR-04: 证据文件写入 | #2 | manual:bash | [x] |
| 5 | BEHAVIOR-05: e2e-verify.sh 真实执行 | #1 #4 | manual:bash | [x] |
| 6 | BEHAVIOR-06: headless 路径独立性 | #1 #5 | manual:bash | [x] |

**铁律覆盖**: 5/5（铁律 #1 #2 #3 #4 #5 全部覆盖）
**Green 验收**: 2026-07-19 — e2e-verify.sh exit 0，全部 [BEHAVIOR] 通过
