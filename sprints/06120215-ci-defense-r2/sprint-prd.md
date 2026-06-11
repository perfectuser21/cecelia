# Sprint PRD — Harness CI 防线 R2（--changed 漏检 + Skill 契约 + 合同存在性 Gate）

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 可靠性
- **本次推进预期**：3 条实证漏洞关闭，CI 对 skill 变更不可绕过

## 背景

三条实证 CI 盲区需封堵：① `vitest --changed` 对 fs 读取型测试不触发（#3334 致 main 潜伏红）；② skill 快照关键不变量（红线/协议字段）被删改时 CI 无感知；③ harness PR 可在无 `contract-draft.md` 的状态下合并。前次 run d8acba51 因 GAN 振荡 + 部署重启孤儿化误判失败，重发。

## Golden Path（核心场景）

用户/CI 从【变更 skill 文件】→ 经过【路由脚本 + 契约测试 + 合同 gate】→ 到达【必红或必绿，且原因可读】

1. **路由触发**：执行 `node packages/brain/scripts/ci/changed-test-router.mjs --files packages/workflows/skills/harness-evaluator/SKILL.md`，输出须包含 skill 契约测试的完整路径（可用 jq/grep 断言具体路径），不得仅输出通用 unit 测试列表
2. **契约测试绿**：对当前 `packages/workflows/skills/` 快照跑 vitest skill 契约测试，全部通过；测试须覆盖：evaluator 含 `env_missing` 红线与 B-1.6/1.7/1.8 步骤、全文无 `ws_id`/`contract-dod-ws` 残留、reviewer 7 维名与 `harness-shared.js ReviewerOutputSchema` 逐字一致、generator 全文无可执行 `gh pr merge` 命令、proposer 含领域验证规则段
3. **篡改 fixture 必红**：对删去 `env_missing` 段的 evaluator SKILL.md 副本跑同一契约测试，测试必非零退出，错误信息须指明缺失的不变量名（不接受仅"snapshot mismatch"）
4. **合同存在性 gate**：对含 `sprints/<dir>/` 变更但缺 `contract-draft.md` 的 diff fixture 执行检查脚本，须非零退出并在 stderr/stdout 指明缺失文件名；对完整 fixture（含 contract-draft.md）执行同一脚本，须 0 退出
5. **CI 接线**：`brain-ci.yml` 在 `packages/workflows/skills/**` 路径变更时，自动触发 Step 1-4 的测试与脚本；yaml 改动最小化，判定逻辑全部在本地可运行的 node 脚本中

## 边界情况

- 负向测试（预期失败）使用 `if cmd; then echo FAIL; exit 1; fi` 或 `&& { …; exit 1; } || true` 惯用法，gate 已识别放行；确属误报用 `gate-allow: <rule-id> <理由>` 豁免留痕
- 契约测试只断言内容不变量，不断言 SKILL.md 行数（避免正常迭代误红）
- `changed-test-router.mjs` 只追加 skill 路由规则，不改现有映射

## 范围限定

**在范围内**：changed-test-router.mjs 增加 skill 路由规则；新增 skill 契约 vitest 测试文件及篡改 fixture；新增合同存在性检查脚本；brain-ci.yml 追加 trigger + job step

**不在范围内**：重构现有 CI 结构；修改 SKILL.md 内容本身；skill-drift 巡检职责（已上线，不重叠）；跨 workflow 文件改动

## 假设

- [ASSUMPTION: changed-test-router.mjs 已存在于 packages/brain/scripts/ci/，本次只追加路由规则]
- [ASSUMPTION: packages/workflows/skills/ 下各 skill 的 SKILL.md 是唯一快照来源，vitest 直接读文件断言]
- [ASSUMPTION: 合同存在性检查脚本接受 git diff --name-only 输出（文件名列表）作为输入，不依赖真实 git history]

## 预期受影响文件

- `packages/brain/scripts/ci/changed-test-router.mjs`：追加 `packages/workflows/skills/**` → skill 契约测试的路由规则
- `packages/brain/scripts/ci/check-contract-exists.mjs`（新建）：合同存在性 gate 脚本
- `packages/brain/tests/skill-contracts/`（新建目录）：evaluator/reviewer/generator/proposer 各 SKILL.md 契约测试 + 篡改 fixture
- `.github/workflows/brain-ci.yml`：追加 `paths: packages/workflows/skills/**` trigger 与对应 job step

## E2E 验收

> 此区块由 proposer 在 GAN 阶段填入可执行脚本（target_environment=local_api → bash + node/vitest/curl）。

```bash
# 占位：proposer 按 local_api 模板填入
# 期望验收点：
# 1. changed-test-router 对 harness-evaluator/SKILL.md 输出包含 skill 契约测试路径（grep 可断言）
# 2. vitest 对当前 packages/workflows/skills/ 快照全绿（exit 0）
# 3. vitest 对篡改 fixture 非零退出，stderr 含 "env_missing"（或具体不变量名）
# 4. check-contract-exists.mjs 对缺合同 fixture 非零退出；对完整 fixture 0 退出
# 5. brain-ci.yml yamllint/actionlint 语法校验通过
```

## journey_type: autonomous
## journey_type_reason: 纯 CI 脚本 + vitest 测试 + yaml 改动，无 dashboard/UI，无 agent 协议，主体在 packages/brain/scripts/ci/
## target_environment: local_api
## target_environment_reason: 全部断言通过本地 node/vitest 执行，无需浏览器或远端机器；CI 也在 runner 本地跑 node
## journey_id: da418741-b9c7-4927-979f-b77268b40e10
## step_id: Deterministic-Gate-6-7
