# Sprint PRD — Harness CI 防线三件套（R8 重发）

## OKR 对齐

- **对应 KR**：Harness Pipeline 零人工门禁可靠性（CI 防线补完）
- **当前进度**：Deterministic Gate 已落 5/7 条
- **本次推进预期**：补完第 6/7 条（最后一条）

## 背景

三个实证漏洞需要 CI 当场拦截：① `vitest --changed` 漏掉「读 skill 文件内容」型测试，skill 快照变了相应测试不跑；② skill 关键防线（evaluator/reviewer/generator/proposer 的不变量段）被删改无守卫；③ harness PR 曾在缺合同文件的情况下进 main。前七发死因均已修或属环境性卡死（最近一发 GAN 回调静默卡死，非合同问题），本次重发。PR #3367/#3373 的完整实现可作参考。

## Golden Path（核心场景）

系统从 [skill/合同文件变更] → 经过 [changed-test-router 选测 + 契约测试守卫 + 合同存在性校验] → 到达 [CI 在 PR 上当场红/绿]

具体（每步过程 stdout 必须 echo 可见，独立裁判逐步核对）：

1. **变更选测**：跑 changed-test-router，传入 `packages/workflows/skills/harness-evaluator/SKILL.md` → 输出「需额外执行的 fs 依赖测试清单」，过程 echo 出清单内容（断言清单确实包含 evaluator 契约测试，不是空）
2. **契约测试当前快照全绿**：新增 skill 契约测试（vitest），对现网 skill 快照全部通过；覆盖：evaluator 含 `env_missing` / `B-1.6` / `1.7` / `1.8` 段、无 `ws_id` 残留；reviewer 7 维名与 `ReviewerOutputSchema` 逐字一致；generator 无可执行 `gh pr merge`；proposer 含「领域验证规则」段
3. **篡改必红**：对一份 fixture 副本删掉 `env_missing` 段 → 跑契约测试，结果为红，且报错信息指明缺失的具体不变量（过程 echo 可见缺失项名）
4. **合同存在性**：对「缺 contract-draft.md」的 diff fixture 跑存在性脚本 → 非零退出并指明缺失；对「含合同」的完整 fixture → 退出 0
5. **CI 接线**：brain CI（`brain-ci-deploy.yml`）对 `packages/workflows/skills/**` 变更强制跑上述三件套（yaml 改动最小，全部判断逻辑落在可本地跑的 node 脚本里）

<!-- Response Schema 由 Proposer 在 Step 1.1 推导，Planner 不定义技术规范。 -->

## 边界情况

- changed-test-router 传入非 skill 文件 → 不应误报 skill 契约测试
- 契约测试 fixture 必须是「副本」，篡改不得污染真实 skill 文件
- 合同存在性脚本对空 diff / 非 harness PR 的行为需明确（不误拦）

## 范围限定

**在范围内**：changed-test-router 的 fs 依赖选测、skill 契约测试（5 类不变量）、合同存在性脚本、brain CI 接线、各脚本的篡改/缺失反例验证、合同 dod-selftest 凭证、E2E 每步过程 echo。

**不在范围内**：重构既有 vitest 配置、改 skill 本身的业务逻辑、GAN 回调静默卡死的根因排查（属环境性，另案）、非 brain CI 的其它 workflow。

## 假设

- [ASSUMPTION: brain CI 对应文件为 `.github/workflows/brain-ci-deploy.yml`（实测仓库中 brain CI 即此文件）]
- [ASSUMPTION: changed-test-router、契约测试、合同存在性脚本均为本 sprint 新建（仓库当前 `packages/brain/scripts/ci/` 不存在）]
- [ASSUMPTION: 契约测试用 vitest，与现有 harness-v5-checks 测试栈一致]

## 预期受影响文件

- `packages/brain/scripts/ci/changed-test-router.mjs`：新建，变更选测（fs 依赖型测试映射）
- `packages/brain/scripts/ci/contract-exists.mjs`（或同义）：新建，合同存在性校验
- `packages/workflows/skills/**` 对应契约测试文件（vitest）：新建，5 类不变量守卫
- 测试 fixtures（篡改副本 / 缺合同 diff / 完整 diff）：新建
- `.github/workflows/brain-ci-deploy.yml`：最小改动，对 `packages/workflows/skills/**` 触发三件套

## E2E 验收

> Planner 初稿留占位 + 自然语言验收点；最终可执行脚本由 proposer 在 GAN 阶段产出（target_environment=local_api → bash + node + vitest）。

```bash
# 占位：proposer 按 local_api 填入真实脚本（node 脚本 + vitest run + 篡改/缺失反例）
# 期望验收点（自然语言，每步过程 stdout 必须 echo 可见）：
# [STEP1] changed-test-router 对 evaluator/SKILL.md 输出的测试清单含 evaluator 契约测试（echo 清单全文）
# [STEP2] 契约测试对现网 skill 快照全绿（echo vitest pass 计数与覆盖的 5 类不变量名）
# [STEP3] 删 env_missing 段的 fixture 副本 → 契约测试红，报错指明缺失不变量名（echo 红色断言行）
# [STEP4] 缺 contract-draft.md 的 diff fixture → 存在性脚本非零退出且指明缺失；完整 fixture → 退出 0（echo 两次退出码）
# [STEP5] brain-ci-deploy.yml 语法校验通过（echo yaml lint / actionlint 结果）
```

## journey_type: autonomous
## journey_type_reason: 纯后端/CI 防线（packages/brain/scripts/ci + brain CI yaml），无 UI、无远端 agent 协议、无 packages/engine 变更，按优先级链落 autonomous。
## target_environment: local_api
## target_environment_reason: 全部判断逻辑为本地可跑 node 脚本 + vitest + actionlint，evaluator 在本地以 curl/psql 之外的 node 进程直跑即可，无需远端机器。
## journey_id: <来源 task.payload.journey_id 缺；Cecelia 唯一 Line = Harness Pipeline，PrepPRD 锚定为该 Journey>
## step_id: <Deterministic Gate 第 6/7 条（最后一条）；具体 Step UUID 由 PrepPRD 锚定结果补>
