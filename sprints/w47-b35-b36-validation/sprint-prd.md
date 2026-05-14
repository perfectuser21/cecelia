# Sprint PRD — W47: sprint_dir 正确传递 E2E 验证（B35+B36）

## OKR 对齐

- **对应 KR**：Harness 流水线稳定性 — 消除 sprint_dir 漂移类 bug
- **当前进度**：B35+B36 单元测试已绿，E2E 未验证
- **本次推进预期**：完成一次真实 harness run，确认 sprint_dir 全链路正确传递

## 背景

B35 修复了 `parsePrdNode` 从 planner verdict JSON 提取 `sprint_dir`（而非依赖 payload）；B36 修复了 planner 输出含历史目录引用时取最后一个匹配（verdict）。两个修复已有单元测试，但尚未经历真实 harness run 的端到端验证。W47 作为验证载体，跑一个最小可观测的薄片。

## Golden Path（核心场景）

系统从 [harness initiative 触发，task.payload.sprint_dir = "sprints"] → 经过 [planner 输出 verdict JSON，含 `sprint_dir: "sprints/w47-b35-b36-validation"` → parsePrdNode 从 plannerOutput 提取该路径 → proposer/generator/evaluator 全程读写 `sprints/w47-b35-b36-validation/`] → 到达 [pipeline 完整完成，无 ENOENT / 无 sprint_dir 错配错误]

具体：
1. Planner（本 PRD）在 verdict JSON 中输出 `sprint_dir: "sprints/w47-b35-b36-validation"`
2. `parsePrdNode` 从 plannerOutput 正则取最后一个 `"sprint_dir"` 值，得到 `sprints/w47-b35-b36-validation`
3. Proposer 读取 `sprints/w47-b35-b36-validation/sprint-prd.md` 起草合同
4. Generator 在同一目录写 `sprint-contract.md` 和实现
5. Evaluator 从同一目录读合同并执行验证

## Response Schema

N/A — 任务无 HTTP 响应（dev_pipeline 内部流程验证）

## 边界情况

- plannerOutput 含历史 sprint 目录引用时 → 必须取最后一个（B36 逻辑）
- payload.sprint_dir 为父目录 "sprints" 时 → 不能直接用父目录，必须从 verdict 提取子目录
- sprint-prd.md 文件不存在时 → parsePrdNode 应抛出明确错误，不能静默 fallback 到错误目录

## 范围限定

**在范围内**：
- 验证 sprint_dir 从 planner verdict → parsePrdNode → 全链路正确传递
- 本 sprint 自身跑完即为验证通过

**不在范围内**：
- 新功能实现（playground endpoint 等）
- B35/B36 代码逻辑修改（已合并，只做验证）
- 其他 harness bug 修复

## 假设

- [ASSUMPTION: B35+B36 代码已合并到 main，当前分支包含这两个修复]
- [ASSUMPTION: harness pipeline 会读取 plannerOutput 中的 verdict JSON]

## 预期受影响文件

- `sprints/w47-b35-b36-validation/sprint-prd.md`：本文件（planner 输出）
- `sprints/w47-b35-b36-validation/sprint-contract.md`：proposer 生成

## journey_type: dev_pipeline
## journey_type_reason: 涉及 harness 流水线内部节点（parsePrdNode/planner/proposer/generator/evaluator），无用户界面交互
