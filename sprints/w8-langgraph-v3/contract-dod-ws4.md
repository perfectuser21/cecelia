---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 4: 故障注入 B — max_fix_rounds → interrupt → resume(abort)

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/04-inject-max-fix-rounds.sh` + `sprints/harness-acceptance-v3/lib/evaluator-fail-injector.mjs`，让 final_evaluate 持续 FAIL 撞 max_fix_rounds，等 W5 interrupt pending 后调用 resume {action:"abort"}，验证 graph 干净到 END(error)。
**大小**: L
**依赖**: Workstream 3

## ARTIFACT 条目

- [ ] [ARTIFACT] 注入脚本存在且可执行
  Test: test -x sprints/harness-acceptance-v3/scripts/04-inject-max-fix-rounds.sh

- [ ] [ARTIFACT] evaluator-fail-injector 库存在且导出 `applyOverride` / `removeOverride` / `pollInterrupt` / `resumeWithAbort`
  Test: node -e "const m=require('./sprints/harness-acceptance-v3/lib/evaluator-fail-injector.mjs');for(const k of ['applyOverride','removeOverride','pollInterrupt','resumeWithAbort']){if(typeof m[k]!=='function')process.exit(1)}"

- [ ] [ARTIFACT] 脚本头含 `set -euo pipefail` + `trap` 清理 evaluator override
  Test: head -10 sprints/harness-acceptance-v3/scripts/04-inject-max-fix-rounds.sh | grep -E "set -euo pipefail" && grep -E "trap.*removeOverride|trap.*cleanup" sprints/harness-acceptance-v3/scripts/04-inject-max-fix-rounds.sh

- [ ] [ARTIFACT] resume 调用 body 显式含 `"action":"abort"`（防写错为 retry/continue）
  Test: grep -E '"action"\s*:\s*"abort"' sprints/harness-acceptance-v3/lib/evaluator-fail-injector.mjs

- [ ] [ARTIFACT] `applyOverride` 内部含 endpoint fallback 顺序（先 API，回落 DB 直写）
  Test: grep -E 'evaluator-override.*||.*harness_evaluator_overrides|harness_evaluator_overrides.*||.*evaluator-override' sprints/harness-acceptance-v3/lib/evaluator-fail-injector.mjs

- [ ] [ARTIFACT] pollInterrupt 含 24h interrupt 自身 timeout 的注释或上限保护
  Test: grep -E '24h|24\s*hour|86400|interrupt.{0,30}timeout' sprints/harness-acceptance-v3/lib/evaluator-fail-injector.mjs

## BEHAVIOR 索引（实际测试在 tests/ws4/）

见 `sprints/w8-langgraph-v3/tests/ws4/inject-max-fix-rounds.test.ts`，覆盖：
- `applyOverride()` 在 API 200 时不触 DB fallback；API 404/500 时 fallback DB 直写
- `removeOverride()` 是幂等的（连续调用两次不抛）
- `resumeWithAbort(interruptId)` body 中 action 严格等于 'abort'，url 形如 `/api/brain/harness-interrupts/<id>/resume`
- `pollInterrupt({taskId, deadline})` 在轮询超过 deadline 后返回 `{ok:false, reason:'timeout'}`，不抛异常
