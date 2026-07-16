# DoD — 07170500-canary-drill-repair

**task_id**: f97f24dc-6779-43cb-b16d-229339f8c8f6
**日期**: 2026-07-17

---

## [BEHAVIOR] 行为断言

[BEHAVIOR-1] 注入 oom 模式后任务 status=in_progress，initiative_runs 有行（orchestrator_version=v2, payload.orchestrator=skill-relay, canary=true），payload.last_container_exit_code=137；watchdog L275 能命中该任务进入处置流程（不再被 `task.status !== 'in_progress'` 过滤）

[BEHAVIOR-2] 轮询 15min 内 watchdog 真实修改 initiative_runs.phase（不依赖 task.status=failed 作为 PASS 判据）；initiative_runs.phase 从 running 变化为 failed/done 时演习断言通过

[BEHAVIOR-3] 超时未处置时 drill_report.verdict=FAIL，exit 1，Bark 告警发出（BARK_URL 已设时）；drill_report content JSON 必含 verdict/mode/assertions/elapsed_ms 四字段，其中 assertions 为数组，每条含 name/pass/detail 三子字段

[BEHAVIOR-4] 调度器 existsSync 失败时打印 `[canary-drill-scheduler] failed: script not found <path>` 日志，返回 {triggered:false, failed:true}，不静默、不返回 {triggered:true, error:...}

[BEHAVIOR-5] 调度器路径优先级：CANARY_DRILL_SCRIPT env > /app/scripts/canary-death-drill.mjs（容器内绝对路径）；exec 前 existsSync 校验，三态日志（triggered/skipped/failed）在所有执行路径上必须打印

[BEHAVIOR-6] pollAssert 超时返回 {pass:false} 时，archiveDrillResult 被调用且 content.verdict === 'FAIL'，主流程 process.exit(1)；禁止超时后 exit 0 静默掩盖失败

---

## Failing Tests（Red → Green）

| 编号 | 文件 | 核心断言 | 初始状态 |
|------|------|---------|--------|
| FT-1A | `packages/brain/src/__tests__/canary-drill-inject-form.test.js` | queued → spawnFn 0 次调用（复现旧 bug） | Red |
| FT-1B | `packages/brain/src/__tests__/canary-drill-inject-form.test.js` | in_progress + initiative_runs → spawnFn 被调用（修复后 Green） | Red |
| FT-2 | `packages/brain/src/__tests__/canary-drill-assert-loop.test.js` | pollAssert 超时 → verdict=FAIL，exit 1 | Red |
| FT-3A | `packages/brain/src/__tests__/canary-drill-scheduler-path.test.js` | 旧版本 ENOENT → triggered:true（复现旧 bug） | Red |
| FT-3B | `packages/brain/src/__tests__/canary-drill-scheduler-path.test.js` | 修复后 ENOENT → triggered:false, failed:true | Red |
| FT-3C | `packages/brain/src/__tests__/canary-drill-scheduler-path.test.js` | CANARY_DRILL_SCRIPT env → 使用自定义路径 | Red |

---

## manual:bash 验收命令

```bash
# 1. 单元测试骨架（Red 阶段验证）
npx vitest run packages/brain/src/__tests__/canary-drill-inject-form.test.js
npx vitest run packages/brain/src/__tests__/canary-drill-assert-loop.test.js
npx vitest run packages/brain/src/__tests__/canary-drill-scheduler-path.test.js

# 2. Staging 实弹（需 :5222 在跑）
STAGING_BRAIN_URL=http://localhost:5222 node scripts/canary-death-drill.mjs oom
echo "exit code: $?"

# 3. 验证 drill_report 结构（四字段必须全部非 null）
curl -s "localhost:5222/api/brain/design-docs?type=drill_report&limit=1" \
  | jq -e '.data[0].content | fromjson | {verdict, mode, elapsed_ms, assertions_count: (.assertions | length)} | select(.verdict != null) | select(.mode != null) | select(.elapsed_ms | type == "number") | select(.assertions_count >= 1)'

# 4. 验证 verdict=PASS 且 elapsed_ms 为正整数
curl -s "localhost:5222/api/brain/design-docs?type=drill_report&limit=1" \
  | jq -e '.data[0].content | fromjson | select(.verdict == "PASS") | select(.elapsed_ms | type == "number")'

# 5. 验证 initiative_runs 注入形态（任务 in_progress，orchestrator=skill-relay）
curl -s "localhost:5222/api/brain/tasks/$CANARY_TASK_ID" \
  | jq -e 'select(.status == "in_progress") | select(.payload.orchestrator == "skill-relay") | select(.payload.canary == true)'

# 6. 确认 watchdog 处置日志（贴原文入 PR）
grep '\[relay-watchdog\]' staging-brain.log | grep "$CANARY_TASK_ID" | tail -5
```

---

## CI 要求

- [ ] `packages/brain/src/__tests__/canary-drill-inject-form.test.js` 进入 brain-ci.yml 对应 job
- [ ] `packages/brain/src/__tests__/canary-drill-assert-loop.test.js` 进入 brain-ci.yml 对应 job
- [ ] `packages/brain/src/__tests__/canary-drill-scheduler-path.test.js` 进入 brain-ci.yml 对应 job
- [ ] 所有 FT 由红转绿后方可 PR merge
- [ ] regression 测试永久留在 CI，不可删除（NFR-N4）
