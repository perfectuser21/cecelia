# Sprint PRD — lint-contract-test-immutability CI 机械闸

## OKR 对齐

- **对应 KR**：质量/CI 自动化（harness 合同不可篡改）
- **当前进度**：待定
- **本次推进预期**：合同测试文件 commit1 后不可改动的机械强制落地

## 背景

CONTRACT IS LAW 原则依赖 LLM evaluator 文本核查，已被实证无效（决策 dc18d43d）。本 sprint 以纯 git 脚本实现机械闸：CI 检测 sprints/*/tests/ 下测试文件相对 commit1 是否有改动，有则拦 PR，零人工介入。

## Golden Path（核心场景）

用户/系统从 [PR 触发 CI] → 经过 [脚本 diff 首次引入 commit vs HEAD blob] → 到达 [合法 exit 0 / 违规 exit 1 + 清单]

具体：

1. CI 检测当前 PR diff 包含 `sprints/*/` 变更（否则 job skip，零成本）
2. 对 diff 范围内每个 `sprints/<dir>/tests/` 下的 `.test.ts` / `.test.js` 文件，用 `git log --diff-filter=A` 定位该文件首次 commit（commit1），对比 commit1 blob 与 HEAD blob
3. 无任何差异 → 脚本 exit 0；有任何差异 → exit 1 并打印被改文件清单，CI job 标红拦 PR

## 边界情况

- 文件首个 commit 无法定位（如历史截断）→ warn 输出、exit 0（误杀优先于漏判）
- 非 harness PR（diff 不含 sprints/ 变更）→ job 自动 skip，普通 PR 零成本
- 历史已 merge sprint 不追溯，只查当前 PR diff 范围

## 范围限定

**在范围内**：
- `scripts/lint-contract-test-immutability.sh <sprint_dir>` 脚本（纯 git，不调外网）
- `.github/workflows/` CI 接线（含 skip 判断）
- 脚本自身的测试（bash fixture 或 vitest）永久进 CI

**不在范围内**：
- generator/evaluator skill 文本改动
- `sprints/*/tests/` 之外其他文件的不可变闸（刀D 另一件）
- 历史已 merge sprint 追溯

## 假设

- [ASSUMPTION: CI 运行器有 git 完整历史访问权限（fetch-depth: 0）]
- [ASSUMPTION: 测试文件扩展名为 .test.ts 或 .test.js]
- [ASSUMPTION: 脚本通过 contract-draft.md 出现或 PR diff 含 sprints/* 来判定 harness PR]

## 预期受影响文件

- `scripts/lint-contract-test-immutability.sh`：新建，主检查逻辑
- `.github/workflows/harness-checks.yml`（或新建 `lint-contract-test-immutability.yml`）：CI 接线
- `sprints/07141333-contract-test-immutability-ci/tests/lint-contract-test-immutability.test.ts`（或 .sh）：failing test 先 commit

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟：待定（PrepPRD 未指定）
- 频控：N/A（纯 CI 脚本）
- 版本要求：无
- 可观测：exit 1 时必须打印被改文件清单；skip 时打印 "No sprints/* changes, skipping"

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [真环境验证] 接缝断言必须在真目标上验证过才算 done；未真验的只能标 logic-done-pending（来源: area）
- [禁止写死环境假设] 屏幕外坐标/阈值/假设调用方传X 等环境假设值禁止写死，要么从环境推导要么真机校准（来源: area）
- [PR 前置检查] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area）
- [单 slot 串行] 同一 slot 内严格串行执行任务，并行只许跨 slot（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块**可留空**（只写占位 + 期望验收点的自然语言描述）。**最终可执行的 E2E 脚本由 proposer 在 GAN 阶段产出**（按 target_environment 选 bash/.ps1 模板，写进 contract-draft.md 的 `## E2E 验收` 区块）。Planner 在此先框定"端到端要验到什么"，供 proposer 翻译成命令。

```bash
# 占位：proposer 将按 target_environment 填入真实脚本（local_api→curl+psql / mac_web→Playwright / windows_*→ps1）
# 期望验收点（自然语言）：
# 1. 构造 fixture git 仓库，tests/x.test.ts 在 commit1 后被第二次修改 → 脚本 exit 1，打印被改文件清单
# 2. fixture 中 tests/x.test.ts 未被修改（仅 commit1）→ 脚本 exit 0
# 3. PR diff 不含 sprints/* 变更 → CI job 输出 skip 并以 exit 0 通过
# 4. failing test 先于脚本实现 commit 到 repo
```

## journey_type: dev_pipeline
## journey_type_reason: 涉及 packages/engine 脚本类 CI 工具（scripts/ + .github/workflows/），属于开发流水线管控
## target_environment: local_api
## target_environment_reason: 由 task payload 显式指定 target_environment=local_api；脚本本地可运行，CI 用 GitHub Actions 标准 ubuntu runner
## journey_id: none
## step_id: none（PrepPRD 未锚定）
