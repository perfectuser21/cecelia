# Sprint PRD — Engine Pipeline 完整性加固

**任务 ID**: c405c6eb-d41a-4794-9398-f80c163c9121  
**创建时间**: 2026-04-09  
**Sprint 目标**: 审查 /dev skill 设计缺陷、加固 Engine pipeline 稳定性、建立 E2E integrity test 覆盖整条 pipeline

---

## 背景

当前 Engine pipeline（/dev skill v5.2.0 + devloop-check.sh v4.2.0 + stop-dev.sh v16.2.0）在日常使用中暴露出以下问题：

1. **/dev skill 设计问题**：Harness 模式下 SKILL.md 对 stop hook 退出逻辑描述与 devloop-check.sh 实际条件不完全对齐；Stage 2 Harness 模式分支的流程说明缺少明确的 PR 创建后 `exit 0` 触发说明。
2. **Pipeline 稳定性问题**：devloop-check.sh 在 cleanup_done 已写入但 PR 尚未合并的边界情况下行为不一致；pre-push hook 与 stop hook 之间存在竞态窗口。
3. **E2E 测试覆盖不足**：现有 `dev-workflow-e2e.test.ts` 只覆盖了 devloop-check 单元行为，没有覆盖 Harness 模式完整路径（Planner → GAN → /dev → exit 0）、CI 触发后 evaluator callback 链路、以及 Brain task 状态回写。

---

## 目标

建立一套可自动化运行的 E2E integrity test，覆盖从 Harness Planner 输出到 /dev PR 创建完成的完整 pipeline，同时修复 /dev skill 文档与代码实现之间的设计偏差。

---

## 功能列表

### Feature 1: /dev skill 设计审查与补全

**用户行为**: 运行 `/dev --task-id <id>` 进入 Harness 模式  
**系统响应**:
- SKILL.md 中 Harness 模式退出条件与 devloop-check.sh v4.2.0 实际逻辑完全对齐
- Stage 1 Harness 路径说明包含 sprint-contract.md 读取验证（文件不存在时报错而非静默跳过）
- Stage 2 Harness 路径说明包含 PR 创建后的 exit 0 触发说明
- stop-dev.sh 中 Harness 模式条件注释与 SKILL.md 一致

**不包含**: 修改 devloop-check.sh 底层逻辑（只修复文档与描述）

---

### Feature 2: Engine pipeline 稳定性修复

**用户行为**: Agent 在各种中断场景下恢复 /dev 执行  
**系统响应**:
- `cleanup_done: true` 写入后若 PR 尚未合并，devloop-check.sh 正确判断为"cleanup 误标"并恢复执行（当前行为：直接 exit 0 导致任务提前结束）
- Harness 模式下 step_2_code 标记完成 + PR 创建后，stop hook 稳定输出 exit 0（无竞态）
- pre-push hook 失败时，.dev-mode 状态不被错误标记为 done

**不包含**: 修改 Brain 端任务调度逻辑

---

### Feature 3: E2E Integrity Test 套件

**用户行为**: 运行 `npx vitest run tests/e2e/` 或 CI L4 触发  
**系统响应**:
- **标准模式完整路径测试**：模拟从 `.dev-mode` 初始状态 → 各 Stage 完成标记 → cleanup_done 的完整状态机转换，每步 devloop_check 返回正确退出码
- **Harness 模式完整路径测试**：模拟 harness_mode=true → step_2_code done → PR 创建 → devloop_check exit 0
- **边界场景测试**：cleanup_done 误标恢复、PR 已合并但 step_4_ship 未写的处理、sprint-contract.md 不存在时的报错
- **Stop hook 集成测试**：stop-dev.sh 在有/无 .dev-lock 场景下的正确退出码

**不包含**: 真实 git push / GitHub API 调用（全部 mock 或本地 git repo 模拟）

---

## 成功标准

- `npx vitest run tests/e2e/` 全部通过（0 failures）
- `/dev` SKILL.md 中 Harness 模式描述与 devloop-check.sh 实际条件字面一致（可 grep 验证）
- cleanup_done 误标场景：devloop_check 返回 exit 2（blocked），而非 exit 0（done）
- Harness 模式正常场景：devloop_check 在 step_2_code done + PR 创建后返回 exit 0
- E2E 测试覆盖率：新增测试覆盖 Harness 路径 + 边界场景至少 6 个用例

---

## 范围限定

**在范围内**:
- `/dev` skill SKILL.md + steps/01-spec.md + steps/02-code.md 文档修复
- `devloop-check.sh` cleanup_done 边界逻辑修复
- `tests/e2e/dev-workflow-e2e.test.ts` 扩展（新增 Harness 模式 + 边界场景用例）
- `stop-dev.sh` Harness 模式注释对齐

**不在范围内**:
- Brain 端任务调度、GAN 合同协商逻辑
- Harness Planner/Generator/Reviewer skill 改动
- CI workflow 文件改动
- 真实网络调用（GitHub API、Brain API）的集成测试
