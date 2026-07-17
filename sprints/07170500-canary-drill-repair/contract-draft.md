# Test Contract — 07170500-canary-drill-repair

**task_id**: f97f24dc-6779-43cb-b16d-229339f8c8f6
**日期**: 2026-07-17

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| FT-1 | `../../tests/regression/canary-drill-repair/canary-drill-inject-form.test.js` | queued / in_progress | watchdog L275 过滤 bug |
| FT-2 | `../../tests/regression/canary-drill-repair/canary-drill-assert-loop.test.js` | pollAssert | exit 0 静默 bug |
| FT-3 | `../../tests/regression/canary-drill-repair/canary-drill-scheduler-path.test.js` | triggered:true / CANARY_DRILL_SCRIPT | 路径错误 bug |

---

## 判定点登记

| 场景 | 预期 | 测试 |
|---|---|---|
| registerCanaryTask() 注册后任务状态为 queued | watchdog L275 `task.status !== 'in_progress'` 过滤，spawnFn 0 次调用 | CT-1 |
| registerCanaryTask() 注册后立即 PATCH status=in_progress | watchdog 进入处置分支，spawnFn 被调用 | CT-2 |
| OOM mode 注入后轮询超时（watchdog 未处置） | result.pass=false，drill_report content.verdict="FAIL"，exit 1 | CT-3 |
| canary-drill-scheduler.js 脚本路径不存在 | 返回 {triggered:false, failed:true}，日志含 [canary-drill-scheduler] failed | CT-4 |
| CANARY_DRILL_SCRIPT=/custom/path/drill.mjs | execFn 入参为该路径 | CT-5 |
| 旧版本 catch 块吞掉 ENOENT 返回 {triggered:true} | 复现旧 bug：triggered===true（Red 阶段验证） | CT-6 |

---

## E2E 验收

**模式**：oom

**命令**：
```bash
STAGING_BRAIN_URL=http://localhost:5222 node scripts/canary-death-drill.mjs oom
```

**验收标准**：

1. **注入形态验证（INV-19）**：任务注册后必须同时满足三项：
   - `task.status === 'in_progress'`
   - `initiative_runs` 表中存在对应行（`orchestrator_version='v2'`，`payload.orchestrator='skill-relay'`，`canary=true`，`phase='running'`）
   - `task.payload.last_container_exit_code === 137`（OOM 模式）

2. **watchdog 处置验证（INV-20）**：演习 PASS 判据为 watchdog 真实修改了 `initiative_runs.phase`，禁止以 `task.status='failed'` 作为 PASS 判据

3. **drill_report 结构验证（INV-21）**：`design_docs` 中写入的 `content` JSON 必含 `verdict`/`mode`/`assertions`/`elapsed_ms` 四字段

4. **exit code**：`verdict=PASS` 时 exit 0；`verdict=FAIL` 时 exit 1（两态均合法，关键是断言真实发生，不得静默 exit 0 掩盖失败）

**验证命令**：
```bash
# 查 drill_report 结构（贴原文入 PR）
curl -s "localhost:5222/api/brain/design-docs?type=drill_report&limit=1" \
  | jq '.data[0].content | fromjson | {verdict, mode, elapsed_ms, assertions_count: (.assertions | length)}'

# 确认 initiative_runs 行存在（watchdog 处置前）
curl -s "localhost:5222/api/brain/tasks/$CANARY_TASK_ID" \
  | jq '{status, orchestrator: .payload.orchestrator, canary: .payload.canary, exit_code: .payload.last_container_exit_code}'

# 确认 watchdog 处置日志（贴原文入 PR）
grep '\[relay-watchdog\]' staging-brain.log | grep "$CANARY_TASK_ID" | tail -5
```

---

## 未覆盖真实链路清单

- `interactive_stuck` 模式 tmux 会话（tmux 不可用时降为 payload-only 注入，不影响核心断言）
- Bark 告警推送（BARK_URL 未设时跳过，不影响演习判定）
