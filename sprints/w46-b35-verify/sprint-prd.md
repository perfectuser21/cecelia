# Sprint PRD — W46 planner verdict sprint_dir 提取验证

## OKR 对齐

- **对应 KR**：Harness 流水线端到端稳定性
- **当前进度**：B35 已合并修复
- **本次推进预期**：验证 planner verdict sprint_dir 字段输出正确，parsePrdNode 提取链路闭合

## 背景

B35 修复了 parsePrdNode 无法从 planner stdout 提取 sprint_dir 的问题。W46 验证：planner 在 verdict JSON 中正确输出 `sprint_dir`，Brain 的 parsePrdNode 能通过 regex 正确提取该值，端到端链路闭合。

## Golden Path（核心场景）

系统从 [planner skill 输出 verdict] → 经过 [parsePrdNode regex 提取 sprint_dir] → 到达 [sprint-prd.md 被从正确路径读取]

具体：
1. planner skill 运行完毕，在 stdout 末尾输出 verdict JSON，包含 `sprint_dir` 字段（字面值为 planner 实际写入 PRD 的目录路径）
2. Brain parsePrdNode 接收 plannerOutput（可能含多行文本前缀），用 regex `/"sprint_dir"\s*:\s*"([^"]+)"/` 提取 sprint_dir
3. parsePrdNode 以提取到的 sprint_dir 拼接路径，读取 `{worktreePath}/{sprint_dir}/sprint-prd.md`
4. 文件读取成功，prdContent 非空，下游节点（proposer）正常收到 PRD

## Response Schema

N/A — 任务无 HTTP 响应。本 sprint 验证的是 parsePrdNode 内部节点的返回值结构：

```json
{
  "sprintDir": "sprints",
  "prdContent": "<string, non-empty>",
  "taskPlan": null
}
```

- `sprintDir`：必须等于 planner verdict JSON 中 `sprint_dir` 字段值
- `prdContent`：必须非空（成功读取 sprint-prd.md）
- `taskPlan`：此阶段为 null（由 proposer 产出）

## 边界情况

- plannerOutput 含多行文本前缀（planner 日志）→ regex 仍可提取 sprint_dir
- plannerOutput 不含 sprint_dir → fallback 到 task.payload.sprint_dir
- plannerOutput 非 JSON → graceful fallback，不 crash

## 范围限定

**在范围内**：
- planner skill 输出 verdict JSON 格式（含 sprint_dir 字段）
- parsePrdNode regex 提取逻辑（B35 fix 已实现）
- 端到端路径闭合验证

**不在范围内**：
- parsePrdNode 之后的下游节点（proposer/generator）
- sprint_dir 子目录扫描逻辑（B34 已修复）
- 新增数据库字段或 schema 变更

## 假设

- [ASSUMPTION: B35 测试（harness-initiative-b35.test.js）全通过即代表核心逻辑正确]
- [ASSUMPTION: planner 以 stdout 末尾一行 JSON 输出 verdict，Brain 取 plannerOutput 即含该 JSON]

## 预期受影响文件

- `packages/brain/src/workflows/harness-initiative.graph.js`：parsePrdNode（B35 已修复，验证通过无需改动）
- `packages/brain/src/workflows/__tests__/harness-initiative-b35.test.js`：B35 验证测试（已存在）

## journey_type: autonomous
## journey_type_reason: 验证 Brain 内部 workflow 节点（parsePrdNode），无 UI 交互，无远端 agent 调用
