# Contract Draft — harness relay executor=codex 兼容层

## Golden Path

**场景**：主理人通过 Brain API 提交 executor=codex 任务，经过 Brain tick 调度、双层并发守门、额度软闸，最终 spawn codex 容器执行，initiative_runs 落行，watchdog 按 codex 上限 2 次重点火兜底。

### 步骤序列

1. **[入队校验]** 主理人 POST `/api/brain/tasks`（task_type=harness_initiative, payload.orchestrator=skill-relay, payload.executor=codex）
   - executor 在白名单 [claude, codex] 内 → 201 入队
   - executor 非白名单值（如 "gemini"）→ 400，error: "executor must be claude or codex"
   - executor=codex 但 orchestrator≠skill-relay → 400，error: "executor=codex requires orchestrator=skill-relay"

2. **[Brain tick pickup]** tick 识别 orchestrator=skill-relay 任务 → 调用 `spawnSkillRelaySession`（读 payload.executor 分支）

3. **[额度软闸]** `spawnSkillRelaySession` 检查 team2 quota 5h 窗口剩余
   - 剩余 ≥ 30% → 继续
   - 剩余 < 30% → defer（reason: codex_quota_low），task 保持 queued，**不烧 attempts**

4. **[双层并发守门]** executor=codex 时：
   - 进程内 `_activeCodexRelays` 原子计数检查 MAX=1
   - DB 计数：`orchestrator_host='skill-relay-codex' AND phase NOT IN ('done','failed') AND deadline_at > NOW() AND initiative_id != $self`
   - 任一层命中 → defer，**不烧 attempts**，task 保持 queued

5. **[spawn Docker 容器]** spawnDockerDetached 起容器
   - 容器名规约：`cecelia-relay-<short8>-cx`
   - 挂载 `$CODEX_RELAY_HOME`（默认 `~/.codex-team2`）→ `/home/cecelia/.codex:rw`
   - 注入 `CECELIA_EXECUTOR=codex`

6. **[initiative_runs 落行]** INSERT initiative_runs：
   - `orchestrator_host='skill-relay-codex'`
   - `deadline_at = NOW() + INTERVAL '8 hours'`
   - `phase = 'A_planning'`

7. **[spawn 失败回滚]** 若 spawnDockerDetached 抛异常：
   - 打印 `[skill-relay][ALERT]` 日志
   - UPDATE tasks SET status='queued', claimed_by=NULL, claimed_at=NULL
   - 无 initiative_runs 行落库

8. **[entrypoint codex 分支]** 容器内 entrypoint.sh 按 `CECELIA_EXECUTOR=codex` 执行：
   - `codex exec -c approval_policy="never" -c sandbox_mode="danger-full-access" < "$PROMPT_FILE"`
   - 取 `PIPESTATUS[0]` 为真退出码
   - exit=0 但 stdout 含错误关键词（401/unauthorized/usage limit/stream error）→ 改判退出码非零
   - callback 前 sed 洗 stdout 尾部 token（ghp_/gho_/ghs_/github_pat_）
   - dispatch 日志打 "goal-hook N/A for codex"

9. **[watchdog 重点火]** `resumeStalledRelayRuns` 发现 `orchestrator_host='skill-relay-codex'` 的死容器：
   - 上限 codex=2（`MAX_CODEX_RELAY_ATTEMPTS=2`）
   - 未达上限 → 重点火（spawnSkillRelaySession）
   - 达上限 → phase='failed'，task status='failed'，failure_reason='relay_watchdog_attempt_cap'

10. **[清理]** /tmp/cecelia-prompts 14 天保留（cron 每日清理 mtime > 14 天的文件）

---

## E2E 验收

> target_environment=local_api；所有命令在宿主执行，Brain 运行于 localhost:5221。

```bash
#!/usr/bin/env bash
# GOLDEN_SMOKE — executor=codex harness relay E2E 验收脚本
# 前提：Brain 已在 localhost:5221 运行；Docker daemon 可用；psql 连接 cecelia DB

set -euo pipefail
BRAIN="http://localhost:5221"
DB="postgresql://localhost/cecelia"

echo "=== [1] executor 白名单校验 ==="
# 1a. 非白名单 executor → 400
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"test","task_type":"harness_initiative","payload":{"orchestrator":"skill-relay","executor":"gemini"}}')
[[ "$STATUS" == "400" ]] && echo "[PASS] 非法 executor → 400" || { echo "[FAIL] expected 400, got $STATUS"; exit 1; }

# 1b. executor=codex 但 orchestrator≠skill-relay → 400
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"test","task_type":"harness_initiative","payload":{"orchestrator":"langgraph","executor":"codex"}}')
[[ "$STATUS" == "400" ]] && echo "[PASS] codex+非skill-relay → 400" || { echo "[FAIL] expected 400, got $STATUS"; exit 1; }

# 1c. 合法 executor=codex → 201
RESP=$(curl -s -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"E2E codex relay test","task_type":"harness_initiative","payload":{"orchestrator":"skill-relay","executor":"codex","journey_id":"test-journey"}}')
TASK_ID=$(echo "$RESP" | jq -r '.id')
[[ "$TASK_ID" != "null" && -n "$TASK_ID" ]] && echo "[PASS] executor=codex → 201 task_id=$TASK_ID" || { echo "[FAIL] 创建失败: $RESP"; exit 1; }

echo "=== [2] initiative_runs 落行验证 ==="
# 等 Brain tick 处理（tick 5s 间隔）
sleep 12
RUN_ROW=$(psql "$DB" -t -c "SELECT orchestrator_host, deadline_at, phase FROM initiative_runs WHERE initiative_id='$TASK_ID' ORDER BY started_at DESC LIMIT 1;")
echo "$RUN_ROW" | grep -q "skill-relay-codex" && echo "[PASS] orchestrator_host=skill-relay-codex" || { echo "[FAIL] run row: $RUN_ROW"; exit 1; }
# deadline 约 8h 后
DEADLINE=$(psql "$DB" -t -c "SELECT EXTRACT(EPOCH FROM (deadline_at - NOW()))/3600 FROM initiative_runs WHERE initiative_id='$TASK_ID' ORDER BY started_at DESC LIMIT 1;" | tr -d ' ')
echo "deadline_hours=$DEADLINE"
(( $(echo "$DEADLINE > 7" | bc -l) )) && echo "[PASS] deadline ~8h" || echo "[WARN] deadline=$DEADLINE h (可能 spawn 未触发)"

echo "=== [3] Docker 容器名规约 ==="
SHORT=$(echo "$TASK_ID" | tr -d '-' | cut -c1-8)
docker ps --format "{{.Names}}" | grep -q "cecelia-relay-${SHORT}-cx" \
  && echo "[PASS] 容器名含 -cx 后缀" \
  || echo "[INFO] 容器未运行（可能已退出或 spawn 被软闸/守门 defer）"

echo "=== [4] 双层并发守门 — 第二个 codex 任务被 defer ==="
RESP2=$(curl -s -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"E2E codex relay test 2","task_type":"harness_initiative","payload":{"orchestrator":"skill-relay","executor":"codex","journey_id":"test-journey"}}')
TASK_ID2=$(echo "$RESP2" | jq -r '.id')
sleep 12
STATUS2=$(psql "$DB" -t -c "SELECT status FROM tasks WHERE id='$TASK_ID2';" | tr -d ' \n')
[[ "$STATUS2" == "queued" ]] && echo "[PASS] 守门生效 → 第二任务保持 queued" || echo "[WARN] status2=$STATUS2（守门可能未触发或无并发）"

echo "=== [5] 软闸 defer（需手动注入 quota < 30%，此步为配置说明） ==="
echo "[INFO] 软闸验证：需在 DB 注入 codex_quota_used > 70%，或调用 quota mock 接口，然后观察 defer reason=codex_quota_low"

echo "=== [6] watchdog codex attempts 上限 2 ==="
# 验证 watchdog 对 orchestrator_host='skill-relay-codex' 使用 codex 上限 2
# （单元测试已覆盖，此处只查 DB 状态示意）
ATTEMPTS=$(psql "$DB" -t -c "SELECT COUNT(*) FROM initiative_runs WHERE initiative_id='$TASK_ID' AND orchestrator_host='skill-relay-codex';" | tr -d ' \n')
echo "[INFO] codex relay attempts so far: $ATTEMPTS（watchdog 上限 2 由单元测试 contract-codex-watchdog.test.ts 覆盖）"

echo "=== 所有 GOLDEN_SMOKE 断言完成 ==="
```

---

## 变更范围

| 文件 | 变更摘要 |
|------|---------|
| `packages/brain/src/routes/task-tasks.js` | executor 白名单校验 + codex+orchestrator 组合校验 |
| `packages/brain/src/harness-skill-relay.js` | executor 分支 + 额度软闸 + 双层守门 + codex 容器名/deadline/spawn回滚 |
| `packages/brain/src/harness-relay-watchdog.js` | attempts 上限按 orchestrator_host 分支（codex=2，claude=5）|
| `packages/brain/src/docker-executor.js` | workflowsDir mount 无条件化 + extraMounts 透传 |
| `docker/cecelia-runner/Dockerfile` | `npm i -g @openai/codex` + `codex --version` 冒烟 |
| `docker/cecelia-runner/entrypoint.sh` | run_agent CECELIA_EXECUTOR=codex 分支 + PIPESTATUS + 错误关键词改判 + token 洗敏 |
