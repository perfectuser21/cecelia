# DoD — 07170500-canary-drill-repair

**task_id**: f97f24dc-6779-43cb-b16d-229339f8c8f6
**日期**: 2026-07-17

---

[BEHAVIOR] 注入 oom 模式后任务 status=in_progress，initiative_runs 有行（orchestrator_version=v2, payload.orchestrator=skill-relay, canary=true），payload.last_container_exit_code=137；watchdog L275 能命中该任务进入处置流程

[BEHAVIOR] 轮询 15min 内 watchdog 真实修改 initiative_runs.phase（不依赖 task.status=failed 作为 PASS 判据）；initiative_runs.phase 从 running 变化为 failed/done 时演习断言通过

[BEHAVIOR] 超时未处置时 drill_report.verdict=FAIL，exit 1，Bark 告警发出（BARK_URL 已设时）；drill_report content JSON 必含 verdict/mode/assertions/elapsed_ms 四字段

[BEHAVIOR] 调度器 existsSync 失败时打印 [canary-drill-scheduler] failed: script not found <path> 日志，返回 {triggered:false, failed:true}，不静默、不返回 {triggered:true, error:...}

[BEHAVIOR] drill_report JSON 含 mode/verdict/assertions/elapsed_ms 四字段，其中 assertions 为数组，每条含 name/pass/detail 三子字段

[BEHAVIOR] 调度器路径优先级：CANARY_DRILL_SCRIPT env > /app/scripts/canary-death-drill.mjs（容器内绝对路径）；exec 前 existsSync 校验，三态日志（triggered/skipped/failed）必须打印

---

## Failing Tests（Red → Green）

| 编号 | 文件 | 核心断言 | 状态 |
|------|------|---------|------|
| FT-1A | `packages/brain/src/__tests__/canary-drill-inject-form.test.js` | queued → spawnFn 0 次调用（复现旧 bug） | Red |
| FT-1B | `packages/brain/src/__tests__/canary-drill-inject-form.test.js` | in_progress + initiative_runs → spawnFn 被调用（修复后 Green） | Red |
| FT-2 | `packages/brain/src/__tests__/canary-drill-assert-loop.test.js` | pollAssert 超时 → verdict=FAIL，exit 1 | Red |
| FT-3A | `packages/brain/src/__tests__/canary-drill-scheduler-path.test.js` | 旧版本 ENOENT → triggered:true（复现旧 bug） | Red |
| FT-3B | `packages/brain/src/__tests__/canary-drill-scheduler-path.test.js` | 修复后 ENOENT → triggered:false, failed:true | Red |
| FT-3C | `packages/brain/src/__tests__/canary-drill-scheduler-path.test.js` | CANARY_DRILL_SCRIPT env → 使用自定义路径 | Red |

---

manual:bash node scripts/canary-death-drill.mjs --mode oom --dry-run && echo "PASS"

---

## CI 要求

- [ ] FT-1/FT-2/FT-3 三个测试文件进入 brain-ci.yml 对应 job
- [ ] 所有 FT 由红转绿后方可 PR merge
- [ ] regression 测试永久留在 CI，不可删除
