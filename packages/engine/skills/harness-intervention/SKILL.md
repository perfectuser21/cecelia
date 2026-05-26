---
id: harness-intervention-skill
description: |
  Harness Intervention — 检测并修复卡死的 harness pipeline。
  读取 docker 日志 + Brain checkpoint + sprint contract，
  识别三类卡死（CI 未触发 / PR 未推 / Brain 状态异常），
  执行修复操作，30s 等待验证，三级降级告警（Bark → 飞书 → cecelia_events）。
version: 1.0.0
created: 2026-05-26
---

> **语言规则**: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。
> **执行规则**: 严格按照下面列出的步骤执行。

# /harness-intervention — Harness 卡死干预

**角色**: Intervention Agent（检测 + 修复 harness pipeline 卡死）
**触发条件**: Brain 调度超时、CI 未触发、PR 未推、Brain 状态异常

---

## 执行流程

### Step 1: 读取 docker 日志（容器状态诊断）

```bash
# 读取最近 200 行容器日志
docker logs --tail 200 cecelia-brain 2>&1 | tee /tmp/brain-logs.txt
docker logs --tail 200 cecelia-engine 2>&1 | tee /tmp/engine-logs.txt

# 检查 harness 容器（如果在独立容器中运行）
docker ps --filter "name=harness" --format "table {{.Names}}\t{{.Status}}\t{{.RunningFor}}"
```

关注信号：
- `ERROR` / `FATAL` / `uncaughtException` — 崩溃
- `tick_stats` 连续相同 — 调度停滞
- `TIMEOUT` / `pending` 超 15 分钟 — 任务卡死

---

### Step 2: 读取 Brain checkpoint（任务状态数据源）

Brain API 运行在端口 5221，提供 checkpoint 数据：

```bash
# 读取当前进行中任务（含 checkpoint 信息）
curl -s "localhost:5221/api/brain/tasks?status=in_progress&limit=20" | \
  python3 -m json.tool

# 读取特定任务 checkpoint 状态
curl -s "localhost:5221/api/brain/tasks/${TASK_ID}/checkpoint" | \
  python3 -m json.tool

# 读取全景上下文（OKR + 活跃任务 + 最近 PR）
curl -s "localhost:5221/api/brain/context"
```

若 Brain API 5221 **不可达**，进入降级策略（见 Step 6）。

---

### Step 3: 读取 sprint contract 文件

```bash
# 定位当前 sprint contract 目录
SPRINT_DIRS=$(find . -name "sprint-contract.md" -path "*/sprints/*" 2>/dev/null | head -5)
echo "发现 contract 文件: $SPRINT_DIRS"

# 读取合同内容（确认 workstream 边界）
cat "${SPRINT_DIR}/sprint-contract.md"

# 读取对应 workstream 的 DoD
cat "${SPRINT_DIR}/contract-dod-ws${WS_IDX}.md"
```

---

### Step 4: 三类卡死类型识别

根据 docker logs + checkpoint 数据，判断属于哪类卡死：

#### 类型 A — CI 未触发

**症状**：
- PR 已推送（`gh pr list` 可见）
- CI checks 未出现（`gh pr checks` 为空或 pending 超 10 分钟）
- Brain 任务状态仍为 `in_progress`

**诊断命令**：
```bash
# 检查 PR CI 状态
gh pr list --state open --json number,title,statusCheckRollup
gh pr checks <PR_NUMBER>
```

**修复操作**：
```bash
# 重新触发 CI（空 commit push）
git commit --allow-empty -m "ci: 重触发 CI"
git push origin HEAD
```

---

#### 类型 B — PR 未推

**症状**：
- Brain 任务状态为 `in_progress` 且超时
- 本地有 commits 但无对应 PR（`gh pr list` 未见）
- docker logs 显示 generator 已完成但未 push

**诊断命令**：
```bash
# 检查本地分支是否有未推送 commits
git log origin/main..HEAD --oneline
git status
```

**修复操作**：
```bash
# 强制推送并创建 PR
git push origin HEAD
gh pr create --title "feat(harness): 恢复推送" --body "intervention: 修复 PR 未推卡死"
```

---

#### 类型 C — Brain 状态异常

**症状**：
- Brain API 响应异常（500 / timeout）
- tick_stats 显示调度循环停滞
- `in_progress` 任务超 30 分钟无进展

**诊断命令**：
```bash
# 检查 Brain 健康状态
curl -s localhost:5221/health
curl -s "localhost:5221/api/brain/tick-stats" | python3 -m json.tool
```

**修复操作**：
```bash
# 重置卡死任务状态
curl -X PATCH "localhost:5221/api/brain/tasks/${TASK_ID}" \
  -H "Content-Type: application/json" \
  -d '{"status":"pending","intervention_note":"harness-intervention 重置"}'

# 若 Brain 进程崩溃，重启服务
docker restart cecelia-brain
# 等待 Brain 启动
sleep 10
curl -s localhost:5221/health
```

---

### Step 5: 修复操作执行（对应三类）

按 Step 4 识别的类型执行对应修复，同时记录干预日志：

```bash
# 记录干预日志到 Brain（若可达）
curl -X POST "localhost:5221/api/brain/events" \
  -H "Content-Type: application/json" \
  -d "{
    \"event_type\": \"harness_intervention\",
    \"task_id\": \"${TASK_ID}\",
    \"stuck_type\": \"${STUCK_TYPE}\",
    \"action\": \"${ACTION_TAKEN}\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }"
```

---

### Step 6: 30s 等待验证

修复操作执行后，**等待 30s** 再验证状态是否恢复：

```bash
echo "[intervention] 等待 30s 验证修复效果..."
sleep 30

# 验证 Brain 状态
TASK_STATUS=$(curl -s "localhost:5221/api/brain/tasks/${TASK_ID}" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))")

echo "[intervention] 30s 后任务状态: $TASK_STATUS"

if [ "$TASK_STATUS" = "completed" ] || [ "$TASK_STATUS" = "in_progress" ]; then
  echo "✅ 修复成功，pipeline 恢复正常"
  INTERVENTION_RESULT="success"
else
  echo "❌ 修复后状态仍异常: $TASK_STATUS，触发告警"
  INTERVENTION_RESULT="failed"
fi
```

---

### Step 7: 三级降级告警

修复失败 或 干预本身需要通知时，按以下优先级依次尝试告警：

#### 级别 1 — Bark 推送（首选）

```bash
BARK_TOKEN="${BARK_TOKEN:-}"  # 从环境变量读取 BARK_TOKEN

if [ -n "$BARK_TOKEN" ]; then
  curl -s "https://api.day.app/${BARK_TOKEN}/Harness干预/${TASK_ID}%20${STUCK_TYPE}%20${INTERVENTION_RESULT}" \
    -d "group=harness&isArchive=1" && \
    echo "[alert] Bark 发送成功" || \
    echo "[alert] Bark 发送失败，降级到飞书"
fi
```

#### 级别 2 — 飞书 Webhook（降级）

```bash
FEISHU_WEBHOOK="${FEISHU_WEBHOOK:-}"

if [ -n "$FEISHU_WEBHOOK" ]; then
  curl -s -X POST "$FEISHU_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "{
      \"msg_type\": \"text\",
      \"content\": {
        \"text\": \"🔧 Harness Intervention\\nTask: ${TASK_ID}\\n卡死类型: ${STUCK_TYPE}\\n结果: ${INTERVENTION_RESULT}\"
      }
    }" && \
    echo "[alert] 飞书发送成功" || \
    echo "[alert] 飞书发送失败，降级到 cecelia_events"
fi
```

#### 级别 3 — cecelia_events 本地事件（最终降级）

```bash
# 即使 Brain API 5221 不可达（unavailable），也写入本地事件队列文件
EVENT_FILE="/tmp/cecelia_events.jsonl"
echo "{
  \"type\": \"harness_intervention_alert\",
  \"task_id\": \"${TASK_ID}\",
  \"stuck_type\": \"${STUCK_TYPE}\",
  \"result\": \"${INTERVENTION_RESULT}\",
  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
}" >> "$EVENT_FILE"

echo "[alert] 事件写入 cecelia_events: $EVENT_FILE"
```

---

### Step 8: Brain API 5221 不可达降级策略

当 Brain API **不可达**（5221 端口无响应 / unavailable）时：

```bash
# 健康检查
if ! curl -s --max-time 3 localhost:5221/health > /dev/null 2>&1; then
  echo "[intervention] Brain API 5221 不可达，进入降级模式"
  
  # 降级策略 1: 直接读取 postgres（如有直连权限）
  TASK_INFO=$(psql -U cecelia -d cecelia -t -c \
    "SELECT status, updated_at FROM tasks WHERE id='${TASK_ID}' LIMIT 1;" 2>/dev/null)
  
  # 降级策略 2: 读取本地 checkpoint 文件（Brain 定期写入）
  CHECKPOINT_FILE="/tmp/brain-checkpoint-${TASK_ID}.json"
  if [ -f "$CHECKPOINT_FILE" ]; then
    cat "$CHECKPOINT_FILE"
  fi
  
  # 降级策略 3: 触发 cecelia_events 告警（不依赖 Brain）
  echo "{\"type\":\"brain_unavailable\",\"task_id\":\"${TASK_ID}\"}" >> /tmp/cecelia_events.jsonl
  
  # 降级策略 4: Bark 直接告警（不经 Brain）
  [ -n "$BARK_TOKEN" ] && \
    curl -s "https://api.day.app/${BARK_TOKEN}/BrainDown/5221不可达"
fi
```

---

## 禁止事项

1. **禁止在 main 分支操作**
2. **禁止跳过 30s 等待** — 修复操作需要传播时间
3. **禁止无限重试** — 同一类型卡死最多重试 3 次，超过则上报
4. **禁止广泛文件搜索** — 只在 `find . -maxdepth 5` 范围内操作
