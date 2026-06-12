# Sprint PRD — CI 防线三件套（R6）

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 稳定性（Brain API 离线，编号不可查）
- **当前进度**：不可知（Brain API 离线）
- **本次推进预期**：堵死 3 个实证漏洞，Deterministic Gate 第 6/7 条达标

## 背景

三个实证漏洞（来自 PrepPRD）：
1. vitest --changed 不感知 fs 读取型测试（改 SKILL.md 但不改 .test.ts → --changed 看不到该 test → latent 红，#3334）
2. skill 关键不变量（evaluator env_missing、reviewer 7 维名等）无快照守卫，悄然被改无人知
3. harness PR 可不带 contract-draft.md 合并（PR #3367 已全实现，本发因 planner 被重启冲掉重建）

## Golden Path（核心场景）

从 [packages/workflows/skills/** 变更触发] → 经 [changed-test-router 感知 + skill 契约测试运行 + 合同存在性检查] → 到 [防线有效：任何遗漏当场报红]

具体步骤：

1. **changed-test-router 感知**  
   `node packages/brain/scripts/ci/changed-test-router.mjs --files packages/workflows/skills/harness-evaluator/SKILL.md`  
   可观测：stdout 输出含 `harness-evaluator.test.ts`（或等效路径）的 fs 依赖测试清单

2. **skill 契约测试正常路径**  
   `npx vitest run packages/engine/tests/skills/` 全绿  
   覆盖不变量：evaluator 含 env_missing / B-1.6/1.7/1.8、无 ws_id 残留；reviewer 7 维名与 ReviewerOutputSchema 逐字一致；generator 无可执行 `gh pr merge`；proposer 含领域验证规则段

3. **篡改验证**  
   修改 evaluator skill fixture（删 env_missing 段副本）后重跑契约测试  
   可观测：vitest 红，错误信息明确指出缺失的不变量名称

4. **合同存在性检查**  
   `node packages/brain/scripts/ci/check-contract-exists.mjs`  
   - 传入缺 `contract-draft.md` 的 diff fixture → 非零退出 + stderr 指明缺失路径  
   - 传入完整 fixture → 退出码 0

5. **CI 自动化**  
   `packages/workflows/skills/**` 有变更的 PR → ci.yml 自动触发步骤 1-4  
   yaml 最小改；逻辑封装在可本地跑的 node 脚本，yaml 只负责调用

## 边界情况

- changed-test-router 传入非 skill 路径（如 `src/server.js`）→ 输出空清单，退出码 0
- skill 不存在于 `~/.claude/skills/` → 契约测试以 `it.skipIf(!skillExists)` 跳过，不报红
- check-contract-exists.mjs 不检查合同内容合法性（已有 harness-contract-lint job 覆盖）

## 范围限定

**在范围内**：
- `packages/brain/scripts/ci/changed-test-router.mjs`（新建）
- `packages/engine/tests/skills/harness-evaluator.test.ts`（新建，evaluator 关键不变量）
- 扩展现有 reviewer / generator / proposer 测试（补缺失的不变量断言）
- `packages/brain/scripts/ci/check-contract-exists.mjs`（新建，合同存在性检查）
- `ci.yml`：新增 step 在 `packages/workflows/skills/**` 变更时调用上述脚本

**不在范围内**：
- 修改 skill 文件本身内容
- harness DoD 完整性校验（已有 `harness-dod-integrity` job）
- 合同内容 lint（已有 `harness-contract-lint` job）

## 假设

- [ASSUMPTION: 契约测试读取 `~/.claude/skills/<skill>/SKILL.md`（同现有 generator/proposer 测试模式）]
- [ASSUMPTION: changed-test-router.mjs 通过扫描 `packages/engine/tests/skills/*.test.ts` 中的 readFileSync 路径，建立 skill 文件 → 测试文件的映射]
- [ASSUMPTION: check-contract-exists.mjs 检查传入 diff 文件列表中是否含 `contract-draft.md`，独立于现有 contract-gate-check.mjs（检内容）]
- [ASSUMPTION: PR #3367 的实现思路可参考，但需在新分支重建]

## 预期受影响文件

- `packages/brain/scripts/ci/changed-test-router.mjs`：新建
- `packages/brain/scripts/ci/check-contract-exists.mjs`：新建
- `packages/engine/tests/skills/harness-evaluator.test.ts`：新建
- `packages/engine/tests/skills/harness-contract-reviewer.test.ts`：扩展 7 维名 + ReviewerOutputSchema 一致性
- `packages/engine/tests/skills/harness-generator.test.ts`：扩展无可执行 gh pr merge 不变量
- `packages/engine/tests/skills/harness-contract-proposer.test.ts`：扩展领域验证规则段存在性
- `.github/workflows/ci.yml`：新增 skills 变更触发 step

## E2E 验收

> Planner 初稿占位，最终可执行脚本由 proposer 在 GAN 阶段产出（target_environment=local_api → node 命令 + vitest + 退出码断言）。

```bash
# 占位：proposer 将填入真实脚本
# 期望验收点（自然语言）：
# 1. changed-test-router.mjs 对 harness-evaluator SKILL.md 输出非空 fs 依赖清单
# 2. vitest packages/engine/tests/skills/ 当前全绿
# 3. 篡改 evaluator fixture → vitest 红且指明缺失 env_missing 不变量
# 4. check-contract-exists.mjs 对缺 contract-draft.md fixture 返回非零退出
# 5. ci.yml yaml 语法通过（actionlint 或 yaml parse 检查）
```

## journey_type: dev_pipeline
## journey_type_reason: 涉及 packages/engine/tests/skills/ CI 基础设施，属 hooks/skills/DevGate 领域
## target_environment: local_api
## target_environment_reason: 逻辑由 node 脚本 + vitest 在本地执行（packages/brain/scripts/ci + packages/engine/tests），E2E 验证 curl localhost:5221 不涉及远端
## journey_id: <来源 task.payload.journey_id；Brain API 离线未能查询，Cecelia Line 唯一=Harness Pipeline>
## step_id: Deterministic Gate 第 6/7 条
