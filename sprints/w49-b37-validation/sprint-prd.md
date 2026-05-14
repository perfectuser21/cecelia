# Sprint PRD — W49 B37验证：git diff 确定性找 sprint 目录

## OKR 对齐

- **对应 KR**：Harness 稳定性 KR（Bug 归零）
- **当前进度**：B37 已合并，待验证
- **本次推进预期**：B37 端到端验证通过，确认 harness 可在真实运行中正确找到 sprint 目录

## 背景

B37 修复（commit 243ee548d）已合并：`parsePrdNode` 改用 `git diff --name-only origin/main HEAD -- sprints/` 确定性找 planner 新建的 sprint 目录，替代脆弱的 LLM 输出 regex 解析。Brain 镜像已含该修复。

W49 任务：在真实 harness 运行中验证 B37 fix 生效——即本次 sprint 运行本身就是验证。

## Golden Path（核心场景）

系统从 [planner 创建 sprint 目录] → 经过 [parsePrdNode 运行 git diff] → 到达 [后续节点使用正确的 sprintDir]

具体：
1. Planner 在 `sprints/w49-b37-validation/` 创建 `sprint-prd.md` 并 commit 到新分支
2. `parsePrdNode` 调用 `git diff --name-only origin/main HEAD -- sprints/` 得到 `sprints/w49-b37-validation/sprint-prd.md`
3. `parsePrdNode` 从 diff 输出提取 `sprintDir = "sprints/w49-b37-validation"`
4. Proposer 将 `sprint-contract.md` 写入 `sprints/w49-b37-validation/`
5. Generator/Evaluator 在 `sprints/w49-b37-validation/` 读取合同文件，无 ENOENT 报错

## Response Schema

N/A — 任务无 HTTP 响应（纯 harness 内部流程验证）

## 边界情况

- git diff 返回空（无新 sprint 文件）→ 保持已有 sprintDir，不覆盖
- 多条 sprint 路径匹配（旧 sprint 和新 sprint 同时出现）→ 取第一个匹配的新目录
- worktreePath 为空 → 跳过 git diff 逻辑，不崩溃

## 范围限定

**在范围内**：
- 验证 parsePrdNode 正确提取 `sprints/w49-b37-validation` 作为 sprintDir
- 验证 Proposer、Generator、Evaluator 均能在正确目录读写文件
- 验证全程无 ENOENT 报错

**不在范围内**：
- 修改 B37 实现代码（已合并，不改）
- 新增功能特性
- 其他 sprint 目录的兼容性测试

## 假设

- [ASSUMPTION: Brain Docker 镜像已包含 B37 修复，`parsePrdNode` 含 git diff 逻辑]
- [ASSUMPTION: harness worktree 正常初始化，`state.worktreePath` 非空]
- [ASSUMPTION: planner commit 后 origin/main 与新分支 HEAD 之间存在 diff]

## 预期受影响文件

- `sprints/w49-b37-validation/sprint-prd.md`：本文件（planner 产出，验证起点）
- `sprints/w49-b37-validation/sprint-contract.md`：Proposer 写入此处（验证 sprintDir 正确传递）
- `packages/brain/src/workflows/harness-initiative.graph.js`：被验证的目标文件（不修改）

## E2E 验收

```bash
# 验证：git diff 找到正确的 sprint 目录（在 harness worktree 中执行）
SPRINT_BRANCH=$(git branch --show-current)
DIFF_OUT=$(git diff --name-only origin/main HEAD -- sprints/ 2>/dev/null)
echo "git diff 输出: $DIFF_OUT"

# 断言 1：diff 输出含 w49-b37-validation
echo "$DIFF_OUT" | grep -q "sprints/w49-b37-validation/" \
  && echo "✅ PASS: git diff 找到正确 sprint 目录" \
  || echo "❌ FAIL: git diff 未找到 sprints/w49-b37-validation/"

# 断言 2：Proposer 合同文件存在（说明 sprintDir 正确传递）
test -f sprints/w49-b37-validation/sprint-contract.md \
  && echo "✅ PASS: sprint-contract.md 存在于正确目录" \
  || echo "❌ FAIL: sprint-contract.md 缺失（sprintDir 可能漂移）"
```

## journey_type: dev_pipeline
## journey_type_reason: 本次 sprint 验证的是 harness 开发流程引擎（parsePrdNode git diff 逻辑），属于开发管道自验证
