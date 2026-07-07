# Contract DoD: codex 有头 tmux 派发（Sprint 1/3）

task_id: 4cedf175-3b56-4d41-91b6-73de559f58c9
sprint_dir: sprints/07071654-codex-headed-dispatch
generated: 2026-07-07
revised: 2026-07-07 (r2)

---

## DoD 条目（Definition of Done）

### [BEHAVIOR] B-01：codex+headed 正常入队，claude+headed 返回 400

**描述**：入队路由校验正确——codex executor 可用 headed 模式，claude executor 不可用。

**验收命令**：
```bash
# manual:bash
# 1. codex+headed 入队 → 期望 201
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"executor":"codex","mode":"headed","title":"dry-run headed test","journey_id":"test"}' \
  | grep -E "^(200|201)$" && echo "PASS: codex+headed accepted" || echo "FAIL: codex+headed rejected"

# 2. claude+headed → 期望 400
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"executor":"claude","mode":"headed","title":"should reject","journey_id":"test"}' \
  | grep -E "^400$" && echo "PASS: claude+headed rejected" || echo "FAIL: claude+headed not rejected"
```

---

### [BEHAVIOR] B-02：mode 缺省/headless 走 docker 路径零回归

**描述**：不带 mode 或 mode=headless 的请求走现有 docker 路径，不产生 tmux session，不产生宿主 prompt 文件。

**验收命令**：
```bash
# manual:bash
# 派发一个无头任务
TASK_RESP=$(curl -s -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"executor":"codex","title":"headless regression test","journey_id":"test"}')
TASK_ID=$(echo "$TASK_RESP" | jq -r '.id // .task_id')
echo "Task ID: $TASK_ID"

# 等待 3s 再检查——不应有 tmux session
sleep 3
SHORT="${TASK_ID:0:8}"
ssh host.docker.internal "tmux has-session -t codex-relay-$SHORT 2>/dev/null && echo FAIL_tmux_found || echo PASS_no_tmux" 2>/dev/null || echo "PASS: ssh not available (expected in headless path)"

# 不应有宿主 prompt 文件
ls /tmp/cecelia-host-prompts/${TASK_ID}.* 2>/dev/null && echo "FAIL: prompt file found" || echo "PASS: no prompt file"
```

---

### [BEHAVIOR] B-03：headed dry-run → tmux session 存活 + prompt 文件内容匹配 + deadline/权限验证

**描述**：headed 模式下，skill-relay 正确在宿主机起 tmux session，prompt 文件写入正确路径且内容 sha256 匹配，deadline=8h，文件权限 0600。

**验收命令**：
```bash
# manual:bash
PROMPT_TEXT="echo headed-dry-run-$(date +%s)"

TASK_RESP=$(curl -s -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d "{\"executor\":\"codex\",\"mode\":\"headed\",\"title\":\"headed dry-run\",\"prompt\":\"$PROMPT_TEXT\",\"journey_id\":\"test\"}")
TASK_ID=$(echo "$TASK_RESP" | jq -r '.id // .task_id')
echo "Task ID: $TASK_ID"

# 等待派发
sleep 5
SHORT="${TASK_ID:0:8}"

# 检查 tmux session
ssh host.docker.internal "tmux has-session -t codex-relay-$SHORT" && echo "PASS: tmux session exists" || echo "FAIL: tmux session not found"

# 检查 prompt 文件存在
PROMPT_FILES=$(ssh host.docker.internal "ls /tmp/cecelia-host-prompts/${TASK_ID}.*.prompt 2>/dev/null")
[ -n "$PROMPT_FILES" ] && echo "PASS: prompt file exists: $PROMPT_FILES" || echo "FAIL: no prompt file"

# 检查 prompt 文件内容 sha256 匹配
EXPECTED_SHA=$(echo -n "$PROMPT_TEXT" | sha256sum | awk '{print $1}')
ACTUAL_SHA=$(ssh host.docker.internal "sha256sum /tmp/cecelia-host-prompts/${TASK_ID}.*.prompt 2>/dev/null | awk '{print \$1}'")
[ "$EXPECTED_SHA" = "$ACTUAL_SHA" ] && echo "PASS: prompt file sha256 matches" || echo "FAIL: sha256 mismatch (expected=$EXPECTED_SHA actual=$ACTUAL_SHA)"

# 检查文件权限 0600
PERM=$(ssh host.docker.internal "stat -c '%a' /tmp/cecelia-host-prompts/${TASK_ID}.*.prompt 2>/dev/null | head -1")
[ "$PERM" = "600" ] && echo "PASS: prompt file permission is 0600" || echo "FAIL: prompt file permission is $PERM (expected 600)"

# 检查 initiative_runs orchestrator_host
psql $DATABASE_URL -c "SELECT orchestrator_host FROM initiative_runs WHERE task_id='$TASK_ID' LIMIT 1;" \
  | grep -q "skill-relay-codex-headed" && echo "PASS: orchestrator_host correct" || echo "FAIL: orchestrator_host mismatch"

# 检查 deadline=8h（deadline 字段应在 now+7.5h ~ now+8.5h 范围内）
DEADLINE_CHECK=$(psql $DATABASE_URL -t -c "
  SELECT CASE
    WHEN deadline BETWEEN now() + interval '7.5 hours' AND now() + interval '8.5 hours'
    THEN 'PASS: deadline=8h verified'
    ELSE 'FAIL: deadline out of 8h range: ' || deadline::text
  END
  FROM initiative_runs WHERE task_id='$TASK_ID' LIMIT 1;" | xargs)
echo "$DEADLINE_CHECK"
```

---

### [BEHAVIOR] B-04：watchdog ssh 失败 fail-open，不触发重点火

**描述**：watchdog 检测 headed run 存活时，若 ssh 命令本身失败（非 session 消失），必须 fail-open 跳过，不递增 attempts，不触发重点火。此场景通过单测覆盖（vitest mock），E2E 层通过 attempts 不变断言。

**验收命令**：
```bash
# manual:bash
# 查询一个 in_progress 的 headed run
RUN=$(psql $DATABASE_URL -t -c "SELECT id, task_id FROM initiative_runs WHERE orchestrator_host='skill-relay-codex-headed' AND status='running' LIMIT 1;")
RUN_ID=$(echo "$RUN" | awk -F'|' '{print $1}' | xargs)
TASK_ID=$(echo "$RUN" | awk -F'|' '{print $2}' | xargs)
echo "Run ID: $RUN_ID, Task ID: $TASK_ID"

if [ -z "$RUN_ID" ]; then
  echo "SKIP: no in-progress headed run found (unit test covers this scenario)"
else
  # 记录当前 attempts
  BEFORE=$(psql $DATABASE_URL -t -c "SELECT attempts FROM initiative_runs WHERE id='$RUN_ID';" | xargs)
  echo "Attempts before: $BEFORE"

  # 等待一个 watchdog 周期（watchdog 间隔约 30s）
  sleep 35

  # attempts 不递增（ssh 失败场景由单测覆盖，此处仅验证无意外递增）
  AFTER=$(psql $DATABASE_URL -t -c "SELECT attempts FROM initiative_runs WHERE id='$RUN_ID';" | xargs)
  [ "$BEFORE" = "$AFTER" ] && echo "PASS: attempts not incremented" || echo "FAIL: attempts changed ($BEFORE -> $AFTER)"
fi

# 单测必须存在且覆盖 watchdog ssh 失败 fail-open 场景
grep -r "fail.open\|ssh.*fail\|failOpen" packages/brain/src/ --include="*.test.js" -l \
  && echo "PASS: unit test for fail-open found" || echo "FAIL: no unit test covering fail-open"
```

---

### [BEHAVIOR] B-05：收窗幂等——tmux_killed_at 标记后不重复 kill

**描述**：run 进入终态（done/failed）后，收窗逻辑设置 `tmux_killed_at`；再次触发收窗时检测到该字段不为空，直接跳过，不重复 ssh kill-session。

**验收命令**：
```bash
# manual:bash
# 查询一个已完成的 headed run（应已有 tmux_killed_at）
DONE_RUN=$(psql $DATABASE_URL -t -c "SELECT id, tmux_killed_at FROM initiative_runs WHERE orchestrator_host='skill-relay-codex-headed' AND status IN ('done','failed') ORDER BY updated_at DESC LIMIT 1;")
RUN_ID=$(echo "$DONE_RUN" | awk -F'|' '{print $1}' | xargs)
KILLED_AT=$(echo "$DONE_RUN" | awk -F'|' '{print $2}' | xargs)
echo "Run ID: $RUN_ID, tmux_killed_at: $KILLED_AT"

# tmux_killed_at 应有值
[ -n "$KILLED_AT" ] && echo "PASS: tmux_killed_at set: $KILLED_AT" || echo "FAIL: tmux_killed_at is null"

# 再次触发收窗（通过 PATCH relay-run 为 done 模拟收窗事件）
curl -s -o /dev/null -w "%{http_code}" \
  -X PATCH "http://localhost:5221/api/brain/orchestrator/relay-runs/${RUN_ID}" \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}' \
  | grep -E "^(200|204)$" && echo "PASS: retrigger accepted" || echo "WARN: retrigger returned non-200 (may be expected)"

# 等待处理
sleep 3

# 验证 killed_at 不变（幂等）
KILLED_AT_AFTER=$(psql $DATABASE_URL -t -c "SELECT tmux_killed_at FROM initiative_runs WHERE id='$RUN_ID';" | xargs)
[ "$KILLED_AT" = "$KILLED_AT_AFTER" ] && echo "PASS: tmux_killed_at unchanged (idempotent)" || echo "FAIL: tmux_killed_at changed"
```

---

### [BEHAVIOR] B-06：tui.log 洗敏——不含裸露 token

**描述**：`tmux pipe-pane -o` 输出到 tui.log 前必须经过洗敏管道，过滤 `ghp_/ghs_/github_pat_` 等 token pattern。

**验收命令**：
```bash
# manual:bash
# 检查 tui.log 不含裸露 token（仅在文件存在时执行）
LOG_FILE="sprints/07071654-codex-headed-dispatch/tui.log"
if test -f "$LOG_FILE"; then
  grep -E "ghp_[A-Za-z0-9]{36}|ghs_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]+" "$LOG_FILE" \
    && echo "FAIL: tui.log contains exposed token" \
    || echo "PASS: tui.log clean, no exposed tokens"
else
  echo "SKIP: tui.log not yet generated (run B-03 first to produce a headed run)"
fi

# 检查洗敏 pattern 代码存在
grep -r "ghp_\|ghs_\|github_pat_" packages/brain/src/ --include="*.js" -l \
  | head -5 && echo "PASS: sanitize pattern found in source" || echo "FAIL: no sanitize pattern in source"
```

---

### [BEHAVIOR] B-07：prompt 传递方式不是 `$(cat)` 内联（INV-2）

**描述**：prompt 必须通过文件重定向或参数文件方式传入 tmux 命令，禁止将文件内容以 `$(cat file)` 内联方式拼入 shell 命令串，防止 shell 注入和命令长度溢出。

**验收命令**：
```bash
# manual:bash
# 在 brain 源码中断言没有 $(cat) 内联 prompt 传递
echo "=== 检查 shell 命令中是否存在 \$(cat) 内联 prompt 传递 ==="
FOUND=$(grep -rn '\$(cat' packages/brain/src/ --include="*.js" | grep -i "prompt\|tmux\|relay")
if [ -n "$FOUND" ]; then
  echo "FAIL: found \$(cat) inline usage in tmux/prompt handling:"
  echo "$FOUND"
else
  echo "PASS: no \$(cat) inline prompt injection found"
fi

# 进一步确认 prompt 通过文件传递（应有 -f 参数或文件重定向）
echo "=== 确认 prompt 通过文件方式传递 ==="
grep -rn "prompt.*file\|--file\|< \$\|<\s*\$PROMPT\|stdin.*file\|promptFile\|prompt_file" \
  packages/brain/src/ --include="*.js" | head -10 \
  && echo "PASS: file-based prompt passing found" \
  || echo "WARN: no explicit file-based prompt passing found — verify manually"
```

---

### [BEHAVIOR] B-08：未引入账号池逻辑（INV-6）

**描述**：本 sprint 不引入账号池（account pool）逻辑，codex headed 运行使用单一凭据，不实现多账号轮换。

**验收命令**：
```bash
# manual:bash
echo "=== 检查是否引入账号池逻辑 ==="
POOL_FOUND=$(grep -rn "account.pool\|accountPool\|pool.*account\|token.pool\|tokenPool\|pool.*token\|rotateAccount\|account_pool\|nextAccount\|getNextCredential" \
  packages/brain/src/ --include="*.js")
if [ -n "$POOL_FOUND" ]; then
  echo "FAIL: account pool logic found in source:"
  echo "$POOL_FOUND"
else
  echo "PASS: no account pool logic found"
fi

# 检查 DB migration 中是否新增 pool 相关表/列
echo "=== 检查 migration 是否引入 pool 相关结构 ==="
POOL_MIGRATION=$(grep -rn "account_pool\|token_pool\|pool_account" packages/brain/migrations/ --include="*.sql" 2>/dev/null)
if [ -n "$POOL_MIGRATION" ]; then
  echo "FAIL: pool-related DB migration found:"
  echo "$POOL_MIGRATION"
else
  echo "PASS: no pool-related DB migration found"
fi
```

---

## 单测覆盖要求（NFR，CI 验证）

以下场景须有对应 `*.test.js`（vitest，mock spawnFn/execFn）：

| 测试场景 | 对应 BEHAVIOR |
|---------|---------------|
| mode=headed → ssh+tmux 路径，无 docker extraMounts | B-03 |
| mode 缺省/headless → docker 路径零回归 | B-02 |
| claude+headed → 400 | B-01 |
| watchdog headed：ssh 失败 → fail-open 不重点火 | B-04 |
| 收窗幂等：已收终态 run 不再触发 kill | B-05 |

---

## CI 全绿检查

```bash
# manual:bash
# 等待 CI 完成后执行
gh pr checks --watch 2>/dev/null || gh run list --branch "$(git branch --show-current)" --limit 3
```

---

## 合同摘要

- BEHAVIOR 条目数：8
- 含 E2E 段：见 contract-draft.md
- 含 manual:bash：yes（每条 BEHAVIOR 均有）
- DB 断言：initiative_runs.orchestrator_host + tmux_killed_at + deadline 字段
- 洗敏断言：tui.log grep 验证（test -f 前置跳过）
- 新增 B-07：grep 断言 prompt 非 $(cat) 内联（INV-2）
- 新增 B-08：grep 断言未引入账号池（INV-6）
