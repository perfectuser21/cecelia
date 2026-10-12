## Brain {VERSION} — coding workflow 活动层与提示词按仓库参数化，加 zenithjoy 预检和 local QA

- 新增 `lib/repo-profile.mjs`：repos.json 条目经信封 `input.repo_profile`（链上活动）/ `cfg.repoProfile`（门禁）传入，翻成 QA 模式、版本碎片规则、回归 smoke 目录、碰生产口径（本仓 ∪ 默认仓）、预检清单名、本仓规矩提示词；没传一律按默认仓（cecelia），旧信封与旧调用方行为不变
- repos.json 每仓库新增 `prechecks`、`rules_prompt`（必填）；runner 执行任务的信封与 QA 门的 evaluate 输入带 `repo_profile`
- `activities/publish.mjs`：版本碎片按 `version_fragment { src_re, dir }`，为 null（zenithjoy）不写 `changes/`
- `lib/ci-precheck.mjs`：`checksFor(profile)` 按仓库挑清单；zenithjoy 以它自己的 CI 为准（L1 测试配对 / TDD 顺序 / 测试质量 / 无假测试 / 版本号 bump、lint-smoke-baseline、L2 Orphan Test Check 内置复刻（未登记 test-registry.yaml 的 .test.js 等被拦，.test.mjs 不受约束）、registry sync、product-map validate、wf-plan / step-dod 漂移）
- `lib/qa-report.mjs`：`productionMatchers` / `productionTouches(executions, patterns)` 按仓库判碰生产（zenithjoy：hk-vps / 100.86.118.99 / :5200，另含 cecelia 生产 Brain）
- `pr-branch` 受保护路径、`qa-smoke` 的目录与登记文件、smoke 剔除重固化按仓库 `qa_smoke`；为 null 的仓库不固化、不判 smoke_missing，smoke_note 写明；QA 固化逻辑拆到 `runner/lib/qa-solidify.mjs`
- 提示词：cecelia 专属规矩抽到 `prompts/repo-rules/cecelia.md`，新增 `prompts/repo-rules/zenithjoy.md`，build / ci-fix / ci-precheck-fix / conflict-fix / qa-fix / commander / spec 注入 `{{REPO_RULES}}`；新增 `prompts/evaluate-local.md`
- zenithjoy 第一阶段 QA = PR worktree 内 local 黑盒：QA 门对 `preview.type=local` 的仓库不起预览、直接跑 evaluate；spec 写 `QA_UNSUPPORTED:`（UI / 真机任务）→ needs_human `qa_mode_unsupported` 上交，不进 build
- `new-task.mjs` 支持 `--repo` / 计划 `repo` / 单条 `repo`，经 repos.json 归一成规范 key，未登记拒绝，未启用提示
- 运行时口径：runner 每 300s 自更新到 origin/main，合并后下一轮起生效；zenithjoy 仍 `enabled=false`，cecelia 路径与行为不变
