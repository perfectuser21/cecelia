# Sprint PRD — CI 防线：--changed 漏检修复 + skill 契约测试 + 合同存在性 gate

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 测试防线健壮性（Deterministic Gate 第 6/7 条）
- **当前进度**：待 Brain API 连通后确认
- **本次推进预期**：封堵三条已实证 CI 漏洞，Deterministic Gate 达成完整防线

## 背景

三个实证漏洞：① brain-unit 用 vitest --changed，fs 读取型测试（readFileSync 读 SKILL.md，不在 import 图）当 SKILL.md 变更时不被触发——#3334 曾让 main 变 latent 红而 CI 全绿；② skill 关键不变量（env_missing 红线、B-1.6/1.7/1.8 步骤、7 维度名）无任何自动守卫，未来静默删除无法被发现；③ 曾发生 contract-draft.md 未随 PR 进 main，report 归档缺源。

## Golden Path（核心场景）

开发者改动 `packages/workflows/skills/` 下任意 SKILL.md → CI 当场拦截契约破坏与合同缺失

具体步骤：
1. **触发**：PR 包含 `packages/workflows/skills/harness-evaluator/SKILL.md`（或其他 skill 文件）变更
2. **漏检路由**：`node packages/brain/scripts/ci/changed-test-router.mjs --files <变更文件列表>` 输出额外需执行的 fs 依赖测试清单（stdout 含 skill 契约测试路径）
3. **契约守护 — 正向**：对当前快照跑 skill 契约 vitest 测试 → 全绿；断言覆盖：evaluator 含 env_missing 红线与 B-1.6/1.7/1.8 步骤、全文无 ws_id/contract-dod-ws 残留、reviewer 7 维名与 harness-shared.js ReviewerOutputSchema 字段逐字一致、generator 全文无 `gh pr merge` 可执行命令、proposer 含领域验证规则段
4. **契约守护 — 反向**：对篡改 fixture（删掉 env_missing 段副本）跑同一测试 → 非零退出，stderr 明示缺失的不变量名
5. **合同存在性**：对含 `sprints/<dir>/` 变更但缺 `contract-draft.md` 的 diff fixture → 非零退出；完整 fixture（含 contract-draft.md）→ 零退出
6. **CI 接线**：brain-ci workflow 在 `packages/workflows/skills/**` 变更时自动运行步骤 2-5；判定逻辑全在本地可执行的 node 脚本中，yaml 仅做触发与调用

## 边界情况

- `changed-test-router.mjs` 缺 --files 参数 → fail-closed（非零退出）
- skill 契约测试只守 packages/workflows/skills/ 当前快照不变量，不验 SSOT 对齐（SSOT 漂移由 skill-drift 巡检负责，职责不重叠）
- 合同存在性检查仅覆盖 `sprints/<dir>/contract-draft.md`，不覆盖归档目录

## 范围限定

**在范围内**：changed-test-router.mjs 新增、skill 快照契约 vitest 测试新增、合同存在性检查脚本（新增或复用现有 contract-gate-check.mjs 入口）、brain-ci 或 ci.yml 追加 packages/workflows/skills/** 触发路径与对应 job

**不在范围内**：现有 CI 结构重构、skill-drift 巡检逻辑修改、vitest --changed 底层机制改造、现有合同文件回溯补全

## 假设

- [ASSUMPTION: Brain API 离线，OKR 进度待 Brain 恢复后核实]
- [ASSUMPTION: 合同存在性检查能力可能已在 contract-gate-check.mjs 或相关 gate 脚本中部分实现，proposer 确认后复用或新建]
- [ASSUMPTION: CI yaml 接线优先追加到 ci.yml 的 brain-unit/changes 触发段，最小改动]

## 预期受影响文件

- `packages/brain/scripts/ci/changed-test-router.mjs`：新增 fs 依赖测试路由脚本
- `packages/brain/src/__tests__/skill-contract.test.js`：新增 skill 快照契约测试（含正向快照 + 反向篡改 fixture）
- `packages/brain/scripts/ci/contract-existence-check.mjs`：新增合同存在性检查脚本（或扩展已有 gate 脚本）
- `.github/workflows/ci.yml`（或 brain-ci-deploy.yml）：追加 `packages/workflows/skills/**` 触发 + skill-ci job

## E2E 验收

> 最终可执行脚本由 proposer 在 GAN 阶段产出（target_environment=local_api → curl + node + vitest 命令）。期望验收点：

```bash
# 1. changed-test-router.mjs 对 skill 文件输入，stdout 含 skill 契约测试路径（非空）
# 2. skill 契约 vitest 测试对当前快照全绿（exit 0）
# 3. 篡改 fixture（删 env_missing 段）→ 同测试非零退出，stderr 含缺失不变量名
# 4. 合同存在性脚本：缺合同 diff fixture → exit 非0；完整 fixture → exit 0
# 5. actionlint 或 yaml -l 验证 CI yaml 变更无语法错误
```

## journey_type: autonomous
## journey_type_reason: 主要代码落在 packages/brain/scripts/ci/ 与 packages/brain/src/__tests__/，属于 brain 内部 CI 守护工具
## target_environment: local_api
## target_environment_reason: 全程 node 脚本 + vitest 本地可运行，无 dashboard/Windows/生产服务器依赖（localhost:5221 Brain API + psql 即覆盖验收范围）
## journey_id: <来源 task.payload.journey_id；Brain API 离线期间 fallback: d8acba51-61b4-4b78-9072-ec4f3beee3b2>
## step_id: ci-defense-deterministic-gate-6-7
