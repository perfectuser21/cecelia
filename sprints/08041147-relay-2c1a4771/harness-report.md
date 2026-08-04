━━━ Sprint: watchdog liveness 探针「从未启动任务」误判 liveness_dead 修复（防复发）  PR #4606  2026-08-04 ━━━

PIPELINE  A+B+C phases · 3 GAN rounds · relay 单session · $0（成本未采集）

Phase          Time    Cost    Result
Planner        -       -       ✅ (sprint-prd.md, invariants=14)
GAN×3          -       -       ✅ APPROVED (rubric 62/70, judgments=2)
Generator      -       -       ✅ TDD Red=b0ea429 / Green=ce775e0
Evaluator      -       -       ✅ PASS (9/9 BEHAVIOR + E2E exit 0, unverifiable 1条已兜底)
Judge          -       -       ✅ PASS (Brain API, 重锚 151403efe)
Reporter       -       -       ✅

DOD 9/9 ✅  FAIL: 无

## 合同未覆盖真实链路清单（规则 C，原样转呈——禁止静默）
- 生产 Brain 运行时 tick 内触发未在本合同 E2E 覆盖｜原因：evaluate 在 merge 前的 worktree 执行，运行中的生产 Brain（localhost:5221）尚未加载新代码，等真实 tick 双确认需 ≥2 个 tick 周期且需真实制造孤儿任务污染生产库｜补位计划：merge 后 brain-deploy 流程重启 Brain，生产端按 PRD NFR「watchdog_kill.reason 可由 Brain DB 直查验证」直接观测（下一个真实从未启动任务出现时 psql 直查）。本合同以「worktree 真代码 + 真 Postgres(cecelia_test) + 真 ps 进程探测」零 mock 覆盖同一代码路径。
- 除上条外本合同无 mock 豁免：tests/ 与 E2E 零 vi.mock、零 stub、零假数据注入（fixture 行为真实 INSERT 的 DB 行，非 mock）。

E2E 截图: （无截图——后端 watchdog 分类逻辑，E2E 为 e2e-verify.sh exit 0）
Learning: （从本次 Sprint 提炼的洞察见 learning.md）
DB sync: journey_features(无关联feature) · api_registry ✅ · Notion pushed ✅
# journey_steps 保留只读兼容（notion-push-sync 仍同步存量数据），新增数据禁止写入；Ability/Feature 一律写 journey_features
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
