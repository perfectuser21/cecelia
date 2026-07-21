# Contract Draft — headless dispatch chain smoke（task 0e242225）

## 任务锚点

- **TASK_ID**: `0e242225-151d-4bea-a920-9ea51d803269`
- **Sprint**: `sprints/07212143-relay-0e242225`
- **PRD**: `sprints/07212143-relay-0e242225/sprint-prd.md`
- **合同分支**: `cp-07212143-ws-0e242225`

## 合同目标

验证 Brain `executor=claude + mode=headless + orchestrator=skill-relay` 完整 dispatch chain 的可观测行为，与 headed 路径（claude-headed-dispatch-smoke.sh）形成对称验收。

**verification_level: L3**（本 smoke 所有验收点均依赖真实 Brain API localhost:5221 + 真实 PostgreSQL；无 mock/stub，每次 CI Smoke Glob Runner 跑真环境）

## 核心断言

### 断言 A — POST tasks(mode=headless) 路径放行

**输入**：POST /api/brain/tasks，payload 含 `{mode: "headless", executor: "claude", orchestrator: "skill-relay"}`

**期望输出**：HTTP 200/201，响应 body 含 `id` 字段（UUID 字符串）

**验证逻辑**：task-tasks.js mode 白名单 `['headless', 'headed']` 包含 headless，应通过校验

---

### 断言 B — POST tasks(mode=invalid) 拒绝

**输入**：POST /api/brain/tasks，payload 含 `{mode: "turbo"}`（不在白名单）

**期望输出**：HTTP 400，响应 body 含 `error` 字段，错误信息包含 "mode must be headless or headed"

**验证逻辑**：task-tasks.js 第 114 行拦截非白名单 mode

---

### 断言 C — GET 任务 payload 三元组完整

**输入**：GET /api/brain/tasks/0e242225-151d-4bea-a920-9ea51d803269

**期望输出**：HTTP 200，payload 字段满足：
- `payload.mode === "headless"`
- `payload.executor === "claude"`
- `payload.orchestrator === "skill-relay"`
- payload 不含 `token`/`github_token`/`anthropic_token` 明文字段（凭据安全）

**验证逻辑**：该 task 由 Brain 以 headless 模式派发，payload 应保留三元组

---

### 断言 D — initiative_runs 落行 orchestrator_host=skill-relay-session

**输入**：DB 查询 `initiative_runs WHERE initiative_id = '0e242225-...'`

**期望输出**：至少一条记录，满足：
- `orchestrator_host = 'skill-relay-session'`（来自 harness-skill-relay.js 第 335 行）
- `phase != 'failed'`（非失败状态）

**验证逻辑**：headless 路径下 isCodex=false，orchestratorHost 映射为 `skill-relay-session`

---

### 断言 E — initiative_runs 含 tmux_killed_at 字段（migration 316 已跑）

**输入**：DB schema 查询 `information_schema.columns WHERE table_name='initiative_runs' AND column_name='tmux_killed_at'`

**期望输出**：字段存在

---

### 断言 F — smoke 脚本文件结构合法且在 allowlist 登记

**输入**：检查 `packages/brain/scripts/smoke/claude-headless-dispatch-smoke.sh` 存在且有 shebang；`packages/quality/smoke-allowlist.txt` 含该文件名

**期望输出**：文件存在 + shebang 合法 + allowlist 登记确认

---

## 边界验收

| 场景 | 期望结果 |
|------|---------|
| mode=turbo（不在白名单） | HTTP 400 拒绝 |
| mode=headless + executor=claude | HTTP 200/201 放行 |
| GET task → payload 含敏感字段 token | FAIL（凭据泄漏） |
| initiative_runs.phase = failed | smoke 标 FAIL，不静默跳过 |

## E2E 验收

期望验收点（已转化为可验证技术断言）：

1. **GET task 三元组**：GET /api/brain/tasks/0e242225-151d-4bea-a920-9ea51d803269 返回 payload.mode=headless / payload.executor=claude / payload.orchestrator=skill-relay，且 payload 不含 token/github_token/anthropic_token 字段

2. **initiative_runs 落行**：DB initiative_runs 中 initiative_id=0e242225-151d-4bea-a920-9ea51d803269 至少一条记录，orchestrator_host=skill-relay-session，phase != failed

3. **mode 校验双向**：POST tasks(mode=headless, executor=claude) → 200/201；POST tasks(mode=turbo) → 400

4. **DB schema 完整**：initiative_runs 表含 tmux_killed_at 字段（migration 316 已跑）

5. **smoke 脚本已登记**：packages/quality/smoke-allowlist.txt 含 claude-headless-dispatch-smoke.sh

```bash
# 手动验证命令（manual:bash）
BRAIN="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
TASK_ID="0e242225-151d-4bea-a920-9ea51d803269"

# C1: GET task 三元组
curl -sf "$BRAIN/api/brain/tasks/$TASK_ID" | python3 -c "
import sys, json
d = json.load(sys.stdin)
p = d.get('payload', {})
assert p.get('mode') == 'headless', f\"mode={p.get('mode')}\"
assert p.get('executor') == 'claude', f\"executor={p.get('executor')}\"
assert p.get('orchestrator') == 'skill-relay', f\"orchestrator={p.get('orchestrator')}\"
for k in ['token','github_token','anthropic_token']:
    assert k not in p, f'payload 含敏感字段 {k}'
print('PASS: GET task 三元组验证通过')
"

# C2: initiative_runs 落行
psql "$DB" -c "
SELECT orchestrator_host, phase FROM initiative_runs
WHERE initiative_id = '$TASK_ID'
  AND orchestrator_host = 'skill-relay-session'
  AND phase != 'failed'
LIMIT 1
" | grep -q "skill-relay-session" && echo "PASS: initiative_runs 落行" || echo "FAIL: initiative_runs 无合法记录"

# C3: mode=headless 放行
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"headless-contract-test","payload":{"executor":"claude","mode":"headless","orchestrator":"skill-relay"}}')
[ "$CODE" = "200" ] || [ "$CODE" = "201" ] && echo "PASS: mode=headless → $CODE" || echo "FAIL: mode=headless → $CODE"

# C4: mode=invalid 拒绝
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"invalid-mode-test","payload":{"executor":"claude","mode":"turbo"}}')
[ "$CODE" = "400" ] && echo "PASS: mode=turbo → 400" || echo "FAIL: mode=turbo → $CODE"

# C5: DB schema
psql "$DB" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name='tmux_killed_at'" | grep -q "tmux_killed_at" && echo "PASS: tmux_killed_at 字段存在" || echo "FAIL: tmux_killed_at 不存在"

# C6: smoke allowlist 登记
grep -q "claude-headless-dispatch-smoke.sh" /workspace/packages/quality/smoke-allowlist.txt && echo "PASS: smoke 已登记" || echo "FAIL: smoke 未登记"
```

## Test Contract

| WS | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `../../tests/regression/relay-0e242225/headless-dispatch-contract.test.js` | BEHAVIOR-1 / BEHAVIOR-2 / BEHAVIOR-3 / BEHAVIOR-4 / BEHAVIOR-5 / BEHAVIOR-6 | Red commit 13087a36e 测试套件失败（6 个新测试 FAIL） |

## 不变量（来自 PRD Invariant 约束）

- [单slot串行] 合同测试不并发触发多个 headless 任务
- [禁写死假设] BRAIN_URL / DATABASE_URL 通过环境变量注入，不硬编码
- [真验才done] 所有验收点均依赖真实 API/DB 信号
- [凭据安全] payload 三元组断言包含敏感字段泄漏检测

## 产物清单

| 产物 | 路径 | 状态 |
|------|------|------|
| contract-draft.md | sprints/07212143-relay-0e242225/contract-draft.md | 本文件 |
| contract-dod.md | sprints/07212143-relay-0e242225/contract-dod.md | 待生成 |
| headless dispatch smoke | packages/brain/scripts/smoke/claude-headless-dispatch-smoke.sh | 待生成 |
| e2e 回归脚本 | sprints/07212143-relay-0e242225/e2e-verify.sh | 待生成 |
| allowlist 登记 | packages/quality/smoke-allowlist.txt | 待更新 |
| 合同测试 | sprints/07212143-relay-0e242225/tests/ | 待生成 |
