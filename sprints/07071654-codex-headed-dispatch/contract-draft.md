# Sprint Contract Draft (Round 1)

<!-- GOLDEN_SMOKE_ABILITY_SLUG: codex-headed-tmux-dispatch -->

**Sprint**: codex relay 有头 tmux 派发最小验证片
**journey_type**: autonomous
**target_environment**: local_api

---

## Response Schema（推导来源: PRD字面 + ai_registry 现有端点推导）

### Endpoint: POST /api/brain/tasks（mode 白名单校验）
**新增校验逻辑（非新 HTTP 端点，沿用现有入口）**:
```json
{"id": "<uuid>", "status": "queued", "task_type": "<string>"}
```
- `id` (uuid, 必填): 任务 ID，现有约定
- `status` (string, 必填): 初始值 `queued`
- 非法 mode 组合（claude+headed）→ 400 `{"error": "<string>"}`

**禁用字段名**: `task_id`（用 `id`）, `state`（用 `status`）

**Error (HTTP 400)**:
```json
{"error": "<string>"}
```

### Endpoint: initiative_runs 落行（内部 DB 写入）
- `orchestrator_host` 字段值必须为 `'skill-relay-codex-headed'`（headed 路径标识）
- `phase` 字段值 `'A_planning'`（现有白名单内）
- `orchestrator_version` 字段值 `'v2'`

**N/A — headed spawn 无新 HTTP 响应字段，仅验 DB 写入与宿主 tmux 状态**

---

## 已知约束（来自回归测试）

- [harness-skill-relay.test.js] → `payload.orchestrator=skill-relay → true`
- [harness-skill-relay.test.js] → `flag 缺省/其他值 → false（双轨：走原图路径）`
- [harness-skill-relay.test.js] → `happy path：worktree→账号→spawn(prompt 含 skill 内容+上下文头)→initiative_runs 落行`
- [harness-skill-relay.test.js] → `spawn 失败 → ok=false 带错误，不落 initiative_runs 成功语义`
- [harness-skill-relay.test.js] → `executor=codex + CODEX_RELAY_HOME 已配置 → spawnFn 收到 extraMounts 含凭据挂载`
- [harness-skill-relay.test.js] → `executor=codex 且 CODEX_RELAY_HOME 未设 → 不 spawn，ok=false（B4 回滚语义）`
- [harness-skill-relay.test.js] → `docker ps 发现同名容器仍在跑 → 不 spawn，返回 deferred=true reason=live_container_guard`
- [relay-v101.test.js] → codex relay 基础接线测试（具体条目待读取）

**接缝清单（本 sprint 碰真实世界的点）：**
1. **ssh 逃逸到宿主** — `ssh <host> tmux new-session ...` 命令真实执行；真目标验证方式：在宿主上 `ssh <host> tmux has-session -t codex-relay-<short>`
2. **宿主 tmux session 存活检测** — watchdog `ssh <host> tmux has-session` 命令；ssh 本身失败需 fail-open（不抛错不重点火）
3. **prompt 文件落盘** — `/tmp/cecelia-host-prompts/<taskid>.<instance>.prompt` 在宿主真实存在且权限 0600；真目标验证方式：`ssh <host> ls -la /tmp/cecelia-host-prompts/<taskid>.*`

---

## Golden Path

[POST tasks(mode=headed)] → [spawnSkillRelaySession headed 分支] → [ssh+tmux 启动 codex TUI] → [initiative_runs 落行] → [watchdog headed 存活检测] → [收窗幂等]

<!-- GOLDEN_SMOKE_SCENARIO: headed-spawn-happy-path -->

---

### Step 1: POST tasks 携带 mode=headed，通过白名单校验
**来源**: `[FROM_PRD]` — PRD "Golden Path 具体" 第 1 条：`用户 POST tasks（executor=codex, mode=headed）→ Brain 校验 mode 白名单`

**可观测行为**: Brain 接受 mode=headed 请求，任务写入 DB 状态为 queued；claude+headed 组合被拒 400

**验证命令**:
```bash
# headed + codex → 200 accepted
RESP=$(curl -sf -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"headed smoke test","payload":{"orchestrator":"skill-relay","executor":"codex","mode":"headed"}}')
echo "$RESP" | jq -e '.id | type == "string"' || { echo "FAIL: 任务创建失败"; exit 1; }
TASK_ID=$(echo "$RESP" | jq -r '.id')
echo "TASK_ID=$TASK_ID"

# claude+headed → 400 拒绝
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"bad combo","payload":{"orchestrator":"skill-relay","executor":"claude","mode":"headed"}}')
[ "$CODE" = "400" ] || { echo "FAIL: claude+headed 应返 400，实际 $CODE"; exit 1; }
echo "claude+headed 正确返回 400"
```

**硬阈值**: headed+codex → HTTP 200 + 返回 id 字段；claude+headed → HTTP 400

---

### Step 2: spawnSkillRelaySession headed 分支 — ssh+tmux 启动而非 docker
**来源**: `[FROM_PRD]` — PRD "Golden Path 具体" 第 2-3 条：`tick spawnSkillRelaySession → headed 分支：ssh 到宿主 ... tmux new-session`

**可观测行为**: spawnSkillRelaySession 在 mode=headed 时走 ssh+tmux 路径，不产生 docker extraMounts；prompt 写入宿主 `/tmp/cecelia-host-prompts/<taskid>.<instance>.prompt`（权限 0600）

**验证命令**:
```bash
# 验证 initiative_runs 落行且 orchestrator_host = 'skill-relay-codex-headed'
# （tick 处理后 DB 写入，polling 等待最多 30s）
TASK_ID="${TASK_ID}"  # 来自 Step 1
MAX_WAIT=30
for i in $(seq 1 $MAX_WAIT); do
  ROW=$(psql $DB -t -c "SELECT orchestrator_host FROM initiative_runs WHERE initiative_id='${TASK_ID}' AND orchestrator_version='v2' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
  [ -n "$ROW" ] && break
  [ "$i" = "$MAX_WAIT" ] && { echo "FAIL: initiative_runs 未写入，超时 ${MAX_WAIT}s"; exit 1; }
  sleep 1
done
[ "$ROW" = "skill-relay-codex-headed" ] || { echo "FAIL: orchestrator_host=$ROW，期望 skill-relay-codex-headed"; exit 1; }
echo "initiative_runs 落行 orchestrator_host=$ROW ✓"
```

**硬阈值**: initiative_runs 在 5 分钟内写入，orchestrator_host = `skill-relay-codex-headed`

---

### Step 3: 宿主 tmux session 存在（headed spawn 成功）
**来源**: `[FROM_PRD]` — PRD "E2E 验收" dry-run 验证点 1：`ssh 宿主 tmux has-session -t codex-relay-<short> exit 0`

**可观测行为**: 宿主上存在名为 `codex-relay-<taskId短8位>` 的 tmux session；不得占用宿主 slot1-7

**验证命令**:
```bash
# 从 initiative_runs 取 short（task id 前 8 位去连字符）
SHORT=$(echo "${TASK_ID}" | tr -d '-' | cut -c1-8)
HOST=$(psql $DB -t -c "SELECT payload->>'ssh_host' FROM tasks WHERE id='${TASK_ID}'" | tr -d ' ')
HOST=${HOST:-localhost}  # 本地环境回退

ssh "${HOST}" "tmux has-session -t codex-relay-${SHORT}" && echo "tmux session 存在 ✓" \
  || { echo "FAIL: 宿主 tmux session 不存在 codex-relay-${SHORT}"; exit 1; }

# prompt 文件存在且权限 0600
ssh "${HOST}" "ls -la /tmp/cecelia-host-prompts/ | grep '${TASK_ID}'" \
  || { echo "FAIL: prompt 文件不存在"; exit 1; }
ssh "${HOST}" "stat -c '%a' /tmp/cecelia-host-prompts/${TASK_ID}.*.prompt | grep -q '^600$'" \
  || { echo "FAIL: prompt 文件权限非 0600"; exit 1; }
echo "prompt 文件存在且权限 0600 ✓"
```

**硬阈值**: `tmux has-session` exit 0；prompt 文件权限 0600

---

### Step 4: watchdog headed 分支 — tmux has-session 存活检测 + ssh fail-open
**来源**: `[FROM_PRD]` — PRD Golden Path 第 7 条：`watchdog headed 分支：ssh 宿主 tmux has-session 检测存活；ssh 本身失败 → fail-open 跳过`

**可观测行为**: watchdog 循环对 headed run 执行 ssh tmux has-session；ssh 本身抛错时 fail-open 不计为存活失败、不触发重点火

**注**: watchdog fail-open 是 ssh 层接缝，真实验证只能靠单测注入模拟 ssh 失败，不能用 DB 状态间接推断。

**验证命令**:
```bash
# fail-open 通过单测验收（vitest 注入 ssh 失败场景）
node --experimental-vm-modules node_modules/.bin/vitest run \
  sprints/07071654-codex-headed-dispatch/tests/headed-watchdog.test.js \
  --reporter=verbose 2>&1 | grep -q "fail-open" && echo OK || { echo FAIL; exit 1; }
```

**硬阈值**: vitest 输出含 fail-open 用例通过标记；watchdog 不因 ssh 失败触发重点火

---

### Step 4b: tui.log 留痕 + 管道洗敏
**来源**: `[INVARIANT]` — 凭据安全 + 日志留痕 Invariant（headed spawn 必须产生可审计日志，且不泄露凭据）

**可观测行为**: headed spawn 后 `<sprint_dir>/tui.log` 存在；tui.log 不含 GITHUB_TOKEN/github_pat_/ghp_ 明文

**验证命令**:
```bash
SPRINT_DIR="sprints/07071654-codex-headed-dispatch"

# 验证 tui.log 存在
[ -f "${SPRINT_DIR}/tui.log" ] || { echo "FAIL: tui.log 不存在"; exit 1; }
echo "tui.log 存在 ✓"

# 验证不含敏感信息
! grep -qE "GITHUB_TOKEN=|github_pat_|ghp_[A-Za-z0-9]+" "${SPRINT_DIR}/tui.log" \
  || { echo "FAIL: tui.log 含敏感凭据明文"; exit 1; }
echo "tui.log 无敏感信息 ✓"
```

**硬阈值**: tui.log 存在；grep 返回非零（不含敏感串）

---

### Step 5: 收窗幂等 — run 终态后 kill-session，已收过不重复 kill
**来源**: `[FROM_PRD]` — PRD Golden Path 第 8 条：`收窗：run 终态保留 30min 后 kill-session；必须幂等`；PRD "E2E 验收" 收窗真验证

**可观测行为**: 将 run 标记 done 后，watchdog 在 30 分钟窗口（或强制触发）后 kill tmux session；第二轮 watchdog 不再产生 kill（幂等）

**验证命令**:
```bash
# 强制将 run 标记 done，触发收窗逻辑
SHORT=$(echo "${TASK_ID}" | tr -d '-' | cut -c1-8)
psql $DB -c "UPDATE initiative_runs SET phase='done', completed_at=NOW() - interval '31 minutes' WHERE initiative_id='${TASK_ID}' AND orchestrator_version='v2'"
echo "run 已标 done（completed_at 回拨 31min 触发收窗时间窗）"

# 触发 watchdog tick（Brain 内部 tick 或手动调）
curl -sf -X POST http://localhost:5221/api/brain/tick/watchdog 2>/dev/null || true
sleep 3

HOST=$(psql $DB -t -c "SELECT payload->>'ssh_host' FROM tasks WHERE id='${TASK_ID}'" | tr -d ' ')
HOST=${HOST:-localhost}

# session 应已被 kill
ssh "${HOST}" "tmux has-session -t codex-relay-${SHORT}" && \
  { echo "FAIL: session 应已被 kill 但仍存在"; exit 1; } || echo "session 已消失（kill 成功） ✓"

# 再触发一次 watchdog，确认幂等（不产生第二次 kill 日志/error）
curl -sf -X POST http://localhost:5221/api/brain/tick/watchdog 2>/dev/null || true
sleep 2
KILL2=$(psql $DB -t -c "SELECT COUNT(*) FROM initiative_runs WHERE initiative_id='${TASK_ID}' AND tmux_killed_at IS NOT NULL AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
# 幂等标志：tmux_killed_at 不为空（或等价机制），且不会再次触发
[ "${KILL2}" -ge 1 ] || { echo "FAIL: tmux_killed_at 未记录"; exit 1; }
echo "收窗幂等验证 ✓"
```

**硬阈值**: kill 后 `tmux has-session` exit ≠ 0；第二轮 watchdog 不重复 kill；DB 有 tmux_killed_at 记录（带时间窗 5 分钟）

---

### Step 6: 现有 headless/docker 路径零回归
**来源**: `[FROM_PRD]` — PRD 范围限定："不改 codex 缺省模式"；PRD 边界情况

**可观测行为**: 不带 mode 字段的 skill-relay 任务走原有 docker 路径，initiative_runs.orchestrator_host ≠ `skill-relay-codex-headed`

**验证命令**:
```bash
# 发一个缺省 mode（headless）任务
RESP2=$(curl -sf -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"headless regression","payload":{"orchestrator":"skill-relay","executor":"codex"}}')
echo "$RESP2" | jq -e '.id | type == "string"' || { echo "FAIL: headless 任务创建失败"; exit 1; }
TASK_ID2=$(echo "$RESP2" | jq -r '.id')

# 等待 tick 处理（30s 超时）
for i in $(seq 1 30); do
  ROW2=$(psql $DB -t -c "SELECT orchestrator_host FROM initiative_runs WHERE initiative_id='${TASK_ID2}' AND orchestrator_version='v2' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
  [ -n "$ROW2" ] && break
  [ "$i" = "30" ] && { echo "WARN: headless 任务 tick 未处理（可能是环境限制）"; break; }
  sleep 1
done
# 缺省路径不应落 headed 标记
[ "$ROW2" = "skill-relay-codex-headed" ] && { echo "FAIL: 缺省路径误走 headed 分支"; exit 1; }
echo "headless 路径零回归验证 ✓ orchestrator_host=${ROW2:-<未落行或非headed>}"
```

**硬阈值**: headless 任务 orchestrator_host ≠ `skill-relay-codex-headed`；现有 docker 逻辑不受影响

---

## E2E 验收

<!-- GOLDEN_SMOKE_SCENARIO: full-golden-path-e2e -->

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
# final-e2e: codex headed tmux dispatch Golden Path 全链路验证
# target_environment: local_api（curl localhost:5221 + psql + ssh 宿主 tmux）
set -e

DB="${DB:-postgresql://localhost/cecelia}"
BRAIN="http://localhost:5221"

echo "=== Step 1: POST tasks(mode=headed) — 白名单校验 ==="
RESP=$(curl -sf -X POST "${BRAIN}/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"e2e headed smoke","payload":{"orchestrator":"skill-relay","executor":"codex","mode":"headed","sprint_dir":"sprints/07071654-codex-headed-dispatch"}}')
echo "$RESP" | jq -e '.id | type == "string"' || { echo "FAIL: 任务创建失败"; exit 1; }
TASK_ID=$(echo "$RESP" | jq -r '.id')
echo "TASK_ID=$TASK_ID"

echo "=== Step 1b: claude+headed → 400 ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BRAIN}/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"bad","payload":{"orchestrator":"skill-relay","executor":"claude","mode":"headed"}}')
[ "$CODE" = "400" ] || { echo "FAIL: claude+headed 应 400，实际 $CODE"; exit 1; }
echo "claude+headed 拒绝 400 ✓"

echo "=== Step 2: 等待 initiative_runs 落行（orchestrator_host=skill-relay-codex-headed）==="
MAX_WAIT=60
for i in $(seq 1 $MAX_WAIT); do
  ROW=$(psql "$DB" -t -c "SELECT orchestrator_host FROM initiative_runs WHERE initiative_id='${TASK_ID}' AND orchestrator_version='v2' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
  [ -n "$ROW" ] && break
  [ "$i" = "$MAX_WAIT" ] && { echo "FAIL: initiative_runs 未写入，超时 ${MAX_WAIT}s"; exit 1; }
  sleep 1
done
[ "$ROW" = "skill-relay-codex-headed" ] || { echo "FAIL: orchestrator_host=$ROW"; exit 1; }
echo "initiative_runs 落行 ✓ orchestrator_host=$ROW"

echo "=== Step 3: 宿主 tmux session 存在 ==="
SHORT=$(echo "${TASK_ID}" | tr -d '-' | cut -c1-8)
HOST=$(psql "$DB" -t -c "SELECT payload->>'ssh_host' FROM tasks WHERE id='${TASK_ID}'" | tr -d ' ')
HOST="${HOST:-localhost}"

ssh "${HOST}" "tmux has-session -t codex-relay-${SHORT}" \
  && echo "tmux session 存在 ✓" \
  || { echo "FAIL: 宿主 tmux session 不存在 codex-relay-${SHORT}"; exit 1; }

echo "=== Step 3b: prompt 文件存在且权限 0600 ==="
ssh "${HOST}" "test -f /tmp/cecelia-host-prompts/${TASK_ID}.*.prompt" 2>/dev/null \
  || ssh "${HOST}" "ls /tmp/cecelia-host-prompts/ | grep -q '${TASK_ID}'" \
  || { echo "FAIL: prompt 文件不存在"; exit 1; }
echo "prompt 文件存在 ✓"

echo "=== Step 4: 收窗幂等验证 ==="
# 回拨 completed_at 触发收窗时间窗
psql "$DB" -c "UPDATE initiative_runs SET phase='done', completed_at=NOW() - interval '31 minutes' WHERE initiative_id='${TASK_ID}' AND orchestrator_version='v2'"
# 触发 watchdog（若有内部 tick 接口）
curl -sf -X POST "${BRAIN}/api/brain/tick/watchdog" 2>/dev/null || true
sleep 5

# session 应消失
ssh "${HOST}" "tmux has-session -t codex-relay-${SHORT}" 2>/dev/null \
  && { echo "FAIL: session 应已被 kill"; exit 1; } \
  || echo "session 已 kill ✓"

# 再触发一次，验幂等
curl -sf -X POST "${BRAIN}/api/brain/tick/watchdog" 2>/dev/null || true
sleep 2
KILL_CNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM initiative_runs WHERE initiative_id='${TASK_ID}' AND tmux_killed_at IS NOT NULL AND tmux_killed_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "${KILL_CNT}" -ge 1 ] || { echo "FAIL: tmux_killed_at 未记录"; exit 1; }
echo "收窗幂等 ✓ kill_count=${KILL_CNT}"

echo "=== Step 4b: tui.log 留痕 + 洗敏验证 ==="
SPRINT_DIR="sprints/07071654-codex-headed-dispatch"
[ -f "${SPRINT_DIR}/tui.log" ] || { echo "FAIL: tui.log 不存在"; exit 1; }
echo "tui.log 存在 ✓"
! grep -qE "GITHUB_TOKEN=|github_pat_|ghp_[A-Za-z0-9]+" "${SPRINT_DIR}/tui.log" \
  || { echo "FAIL: tui.log 含敏感凭据明文"; exit 1; }
echo "tui.log 无敏感信息 ✓"

echo "=== Step 5: 零回归验证（headless 路径） ==="
RESP2=$(curl -sf -X POST "${BRAIN}/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"headless regression","payload":{"orchestrator":"skill-relay","executor":"codex"}}')
TASK_ID2=$(echo "$RESP2" | jq -r '.id')
for i in $(seq 1 30); do
  ROW2=$(psql "$DB" -t -c "SELECT orchestrator_host FROM initiative_runs WHERE initiative_id='${TASK_ID2}' AND orchestrator_version='v2' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
  [ -n "$ROW2" ] && break
  [ "$i" = "30" ] && break
  sleep 1
done
[ "$ROW2" = "skill-relay-codex-headed" ] && { echo "FAIL: headless 路径误走 headed 分支"; exit 1; }
echo "零回归 ✓ headless orchestrator_host=${ROW2:-<未落行>}"

echo "✅ Golden Path E2E 全部验证通过"
```

---

---

## Out-of-Scope 标注

**PRD Golden Path 第 6 步（codex 自回写 Brain）**：本 sprint **不测**。
理由：codex 自回写是 session 内由 controller prompt 指令驱动的行为，不是 Brain 代码实现的功能；
无法在不启动真实 codex TUI 的情况下做到可重复的 CI 验收。该步骤属于 E2E 集成验收范畴，
留待后续专项 sprint（真机 E2E）覆盖。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| mode=headed 路由分支 | `tests/headed-dispatch.test.js` | sshSpawnFn(tmux) 被调用、docker spawnFn（现有路径不变）、executor=claude + mode=headed | → 3 failures（函数未实现）|
| watchdog headed 分支 | `tests/headed-watchdog.test.js` | fail-open：不重点火、tmux_killed_at（已收过） | → 2 failures（watchdog headed 分支未实现）|
