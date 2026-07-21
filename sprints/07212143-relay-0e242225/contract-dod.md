# Contract DoD — headless dispatch chain smoke（task 0e242225）

## 元数据

- **TASK_ID**: `0e242225-151d-4bea-a920-9ea51d803269`
- **Sprint**: `sprints/07212143-relay-0e242225`
- **合同类型**: smoke / regression
- **target_environment**: local_api（curl localhost:5221 + psql）

---

## [BEHAVIOR] 条目

### [BEHAVIOR-1] POST tasks(mode=headless, executor=claude, orchestrator=skill-relay) → 200/201 + task id

**类型**: API 响应行为
**场景**: Brain 接收合法 headless dispatch 请求
**输入**:
```json
{
  "task_type": "harness_initiative",
  "title": "headless-smoke-test",
  "payload": {
    "executor": "claude",
    "mode": "headless",
    "orchestrator": "skill-relay"
  }
}
```
**期望**:
- HTTP 状态码 200 或 201
- 响应 body 含 `id` 字段，值为 UUID 字符串
**根据**: task-tasks.js mode 白名单 `['headless', 'headed']`，headless 合法，应放行

**manual:bash**:
```bash
BRAIN="${BRAIN_URL:-http://localhost:5221}"
RESP=$(curl -sf -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"headless-smoke-test","payload":{"executor":"claude","mode":"headless","orchestrator":"skill-relay"}}' 2>/dev/null)
echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);assert isinstance(d.get('id'),str),'id 字段缺失';print('PASS: id='+d['id'])"
```

---

### [BEHAVIOR-2] POST tasks(mode=invalid) → 400 拒绝，不创建任务

**类型**: 输入校验拒绝行为
**场景**: Brain 接收非白名单 mode 值，应拦截返回 400
**输入**:
```json
{
  "task_type": "harness_initiative",
  "title": "invalid-mode",
  "payload": {
    "executor": "claude",
    "mode": "turbo"
  }
}
```
**期望**:
- HTTP 状态码 400
- 响应 body 含 `error` 字段，内容包含 "mode must be headless or headed"
**根据**: task-tasks.js 第 114 行 `!['headless', 'headed'].includes(mode)` 拦截

**manual:bash**:
```bash
BRAIN="${BRAIN_URL:-http://localhost:5221}"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"invalid-mode","payload":{"executor":"claude","mode":"turbo"}}')
[ "$CODE" = "400" ] && echo "PASS: mode=turbo → 400 拒绝" || { echo "FAIL: 期望 400，实际 $CODE"; exit 1; }
```

---

### [BEHAVIOR-3] GET /api/brain/tasks/0e242225-... payload 含三元组且无敏感字段

**类型**: 数据存储完整性行为
**场景**: 已派发的 headless task payload 三元组持久化正确，且凭据未泄漏
**输入**: GET /api/brain/tasks/0e242225-151d-4bea-a920-9ea51d803269
**期望**:
- HTTP 200
- `payload.mode === "headless"`
- `payload.executor === "claude"`
- `payload.orchestrator === "skill-relay"`
- payload 不含 `token` / `github_token` / `anthropic_token` 字段

**manual:bash**:
```bash
BRAIN="${BRAIN_URL:-http://localhost:5221}"
TASK_ID="0e242225-151d-4bea-a920-9ea51d803269"
curl -sf "$BRAIN/api/brain/tasks/$TASK_ID" | python3 -c "
import sys, json
d = json.load(sys.stdin)
p = d.get('payload', {})
checks = [
    (p.get('mode') == 'headless', 'payload.mode != headless, got: ' + str(p.get('mode'))),
    (p.get('executor') == 'claude', 'payload.executor != claude, got: ' + str(p.get('executor'))),
    (p.get('orchestrator') == 'skill-relay', 'payload.orchestrator != skill-relay, got: ' + str(p.get('orchestrator'))),
]
for k in ['token','github_token','anthropic_token']:
    checks.append((k not in p, f'payload 含敏感字段 {k}'))
failed = [msg for ok, msg in checks if not ok]
if failed:
    print('FAIL:', '; '.join(failed)); sys.exit(1)
print('PASS: payload 三元组正确且无敏感字段')
"
```

---

### [BEHAVIOR-4] DB initiative_runs 含 orchestrator_host=skill-relay-session 记录，phase 非 failed

**类型**: DB 落行行为
**场景**: headless 路径 spawnSkillRelaySession 成功后 initiative_runs 落行，isCodex=false 映射为 skill-relay-session
**输入**: `SELECT orchestrator_host, phase FROM initiative_runs WHERE initiative_id='0e242225-...' AND orchestrator_host='skill-relay-session'`
**期望**:
- 至少一条记录
- `orchestrator_host = 'skill-relay-session'`
- `phase != 'failed'`
**根据**: harness-skill-relay.js 第 335 行 `isCodex ? 'skill-relay-codex' : 'skill-relay-session'`

**manual:bash**:
```bash
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
TASK_ID="0e242225-151d-4bea-a920-9ea51d803269"
COUNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM initiative_runs WHERE initiative_id='$TASK_ID' AND orchestrator_host='skill-relay-session' AND phase!='failed'" 2>/dev/null | tr -d ' ')
[ "${COUNT:-0}" -ge 1 ] && echo "PASS: initiative_runs 落行 $COUNT 条" || { echo "FAIL: initiative_runs 无合法记录（orchestrator_host=skill-relay-session, phase!=failed）"; exit 1; }
```

---

### [BEHAVIOR-5] initiative_runs 含 tmux_killed_at 字段（migration 316 已跑）

**类型**: DB schema 完整性行为
**场景**: migration 316 成功执行后 initiative_runs 表含 tmux_killed_at 字段
**输入**: `information_schema.columns WHERE table_name='initiative_runs' AND column_name='tmux_killed_at'`
**期望**: 字段存在

**manual:bash**:
```bash
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
COL=$(psql "$DB" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name='tmux_killed_at'" 2>/dev/null | tr -d ' ')
[ "$COL" = "tmux_killed_at" ] && echo "PASS: tmux_killed_at 字段存在" || { echo "FAIL: tmux_killed_at 字段不存在（migration 316 未跑？）"; exit 1; }
```

---

### [BEHAVIOR-6] 新 smoke 脚本已在 smoke-allowlist.txt 登记且文件结构合法

**类型**: 工程合规行为
**场景**: claude-headless-dispatch-smoke.sh 存在、有合法 shebang、已在 allowlist 登记
**期望**:
- 文件 `packages/brain/scripts/smoke/claude-headless-dispatch-smoke.sh` 存在
- 首行为 `#!/usr/bin/env bash`
- `packages/quality/smoke-allowlist.txt` 含 `claude-headless-dispatch-smoke.sh`

**manual:bash**:
```bash
SMOKE_FILE="/workspace/packages/brain/scripts/smoke/claude-headless-dispatch-smoke.sh"
ALLOWLIST="/workspace/packages/quality/smoke-allowlist.txt"
[ -f "$SMOKE_FILE" ] && echo "PASS: smoke 脚本文件存在" || { echo "FAIL: smoke 脚本文件不存在"; exit 1; }
head -1 "$SMOKE_FILE" | grep -q "#!/usr/bin/env bash" && echo "PASS: shebang 合法" || { echo "FAIL: shebang 不合法"; exit 1; }
grep -q "claude-headless-dispatch-smoke.sh" "$ALLOWLIST" && echo "PASS: allowlist 已登记" || { echo "FAIL: smoke 未在 allowlist 登记"; exit 1; }
```

---

## 验收汇总

| # | [BEHAVIOR] | 类型 | manual:bash |
|---|-----------|------|-------------|
| 1 | POST tasks(mode=headless) → 200/201 + id | API 响应 | 是 |
| 2 | POST tasks(mode=invalid) → 400 拒绝 | 输入校验 | 是 |
| 3 | GET task payload 三元组 + 无敏感字段 | 数据完整性 | 是 |
| 4 | initiative_runs 落行 orchestrator_host=skill-relay-session | DB 落行 | 是 |
| 5 | initiative_runs 含 tmux_killed_at 字段 | DB schema | 是 |
| 6 | smoke 脚本登记 + 结构合法 | 工程合规 | 是 |

**[BEHAVIOR] 总数**: 6
**manual:bash 覆盖率**: 6/6（100%）
**## E2E 验收**: 见 contract-draft.md
