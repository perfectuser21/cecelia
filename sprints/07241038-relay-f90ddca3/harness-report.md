━━━ Sprint: headed relay 派发链路自测（claude-headed, task f90ddca3）  PR #4315  2026-07-24 ━━━

PIPELINE  A+B+C phases · 1 GAN round · judge 2 rounds(首轮 mechFail=missing_exit_code) · $0(unsettled)

Phase          Time    Cost    Result
Planner        -       -       ✅ sprint-prd.md@050e8be55, invariants=53
GAN Reviewer   -       -       ✅ r1 APPROVED, rubric 7维全≥8, judgments=4
Generator      -       -       ✅ red=1e6f172, green=cdd6eb0（TDD 两 commit）
Evaluator      -       -       ✅ PASS sha=cdd6eb0, 23/23 BEHAVIOR + 65/65 DoD Test 真跑, unverifiable=0
Judge          -       -       ✅ PASS（DeepSeek 真裁决；首轮补顶层 exit_code/log_tail 后重判通过）
Merge          -       -       ✅ squash c408b208d, 2026-07-24T15:34:59Z, CI 全绿
Reporter       -       -       ✅

DOD 65/65 ✅  FAIL: 无
未覆盖真实链路清单: N/A（无 mock 豁免）
staging_e2e: 已派生（created=true，任务已入队）

交付物:
- scripts/smoke/e2e/relay-f90ddca3.sh（永久池 e2e wrapper）
- tests/regression/relay-f90ddca3/headed-smoke-contract.test.ts（永久池回归测试）

E2E 截图: （无截图——CLI 链路自测）
Learning: （从本次 Sprint 提炼的洞察见 learning.md）
DB sync: api_registry/test_registry ✅ · Notion pushed ✅
# journey_steps 保留只读兼容，新增数据禁止写入；Ability/Feature 一律写 journey_features
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
