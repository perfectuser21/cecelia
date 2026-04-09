# Sprint PRD — Engine Pipeline 端到端稳定性加固

task_id: 702c9dbf-b67b-497d-b58b-6d6c753b4436

---

## 背景

Cecelia Engine pipeline 承载所有代码变更的生命周期管理（/dev skill → worktree → hooks → DoD → CI → PR merge），是整个系统稳定性的基石。当前存在以下已知痛点：

1. `/dev` skill 的 worktree 流程在边界场景下（冲突、锁残留、hook 失败重试）行为不可预期
2. Engine hooks 与 DoD 验证之间存在校验盲区，部分格式错误只在 CI 阶段才被发现
3. 缺乏端到端的 integrity test，无法在不触发真实 CI 的情况下验证完整 pipeline 健康度
4. CI/CD 环节存在评估空白，不确定现有 gate 是否覆盖所有关键路径

---

## 目标

通过审查、修复和补充测试，使 Engine pipeline 从 `/dev` 触发到 PR merge 的完整链路达到可观测、可验证、稳定运行的状态。

---

## 功能列表

### Feature 1: /dev Skill 行为审查与加固

**用户行为**: 开发者执行 `/dev`，期望它能可靠地完成 worktree 创建→开发→hook 验证→push 全流程

**系统响应**:
- worktree 创建失败时给出明确错误（不静默失败）
- `.dev-lock` 残留时提示清理方式，不阻塞新任务
- hook 失败时展示失败原因，并指明修复方向
- DoD 未勾选时阻止 push，并列出未通过项

**不包含**: 修改 hook 的具体业务逻辑、变更 CI 工作流文件

---

### Feature 2: Engine Pipeline 不稳定点修复

**用户行为**: 开发者在正常开发流程中遇到随机失败的 hook 或格式校验拒绝

**系统响应**:
- `check-dod-mapping.cjs` 对 `manual:` 命令的白名单校验给出清晰报错（含具体命令名）
- `branch-protect.sh` 在 worktree 环境下正确检测 PRD/DoD 文件位置
- Learning Format Gate 对同名文件的 diff context 陷阱给出明确提示
- Stop Hook 正确扫描所有活跃 worktree 中的 `.dev-lock`

**不包含**: 修改 Brain 调度逻辑、变更 N8N 工作流

---

### Feature 3: CI/CD 环节评估与补充

**用户行为**: 团队期望 CI gate 能在机器执行时捕获所有已知格式/行为错误

**系统响应**:
- 盘点现有 L1/L2/L3/L4 gate 的实际覆盖范围
- 识别只在本地 hook 检测、CI 未覆盖的盲区
- 对每个盲区提出是否补充 CI gate 的建议（含理由）

**不包含**: 实际新增 CI workflow 文件（评估结论写入 PRD 附录）

---

### Feature 4: E2E Integrity Test 设计与实现

**用户行为**: 系统维护者希望用一条命令验证整条 pipeline 是否健康，而无需触发真实 PR 或等待 CI

**系统响应**:
- 提供 `packages/engine/scripts/e2e-integrity-check.sh`（或 `.cjs`）
- 脚本覆盖：worktree 创建能力 / hook 可执行性 / DoD 格式校验 / Learning 格式校验 / branch-protect 检测逻辑
- 每项检测输出 PASS/FAIL + 原因
- 脚本可在 CI 外独立运行（无需 Brain 在线、无需真实 push）
- 脚本在 `engine-ci.yml` 中作为独立 job 接入（L0 smoke test）

**不包含**: 模拟真实 GitHub Actions 环境、测试 Brain API 连通性

---

## 成功标准

- `/dev` 在 5 个典型边界场景（锁残留/hook失败/DoD未勾/worktree冲突/同名Learning）下均有明确错误提示而非静默失败
- `e2e-integrity-check` 脚本在全新 worktree 环境运行通过率 100%
- CI/CD 评估报告列出至少 3 个已确认覆盖项和至少 1 个建议补充项
- Pipeline 从 `/dev` 触发到 hook 验证的关键路径有测试覆盖

## 成功标准

- [ ] `/dev` 边界场景错误提示明确（≥5 个场景）
- [ ] `e2e-integrity-check.sh` 全项 PASS（独立运行）
- [ ] CI 盲区评估报告已输出（含覆盖项 + 建议项）
- [ ] engine-ci.yml 接入 L0 smoke test job

---

## 范围限定

**在范围内**:
- `packages/engine/` 下的 hooks、scripts、skills
- `/dev` skill 的流程描述与错误处理
- `engine-ci.yml` 中新增 L0 smoke test
- CI/CD gate 覆盖范围评估文档

**不在范围内**:
- `packages/brain/` 任何代码
- Brain API、tick loop、调度逻辑
- N8N 工作流
- Dashboard / apps/ 前端代码
- 已有 L1/L2/L3/L4 CI job 的修改（只新增 L0）
