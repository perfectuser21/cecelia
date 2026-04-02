# Learning: 精简 branch-protect.sh（v28）

## 变更摘要
branch-protect.sh 从 998 行精简到 206 行（-79%），删除所有 PRD/DoD/数据库/Learning/版本检查，只保留核心保护逻辑。

## 删除的检查（移交 CI）
- PRD 文件存在 + 内容验证 + 更新检查
- DoD 文件存在 + 内容验证 + 更新检查
- Task Card 内容验证
- 数据库 PRD/DoD 检查（curl Brain API）
- Task Checkpoint 检查（tasks_created/step_3_status）
- Monorepo 子目录 PRD 保护（v25）
- .dod.md branch field 校验（v27）
- 分支日期范围检查（v26）

## 保留的检查
- JSON 输入解析 + Write/Edit 过滤
- .dev-mode verify-step 状态机（v26）
- Gate seal 防伪（spec_review/code_review_gate）
- 全局配置目录保护（hooks/skills）
- cp-* 分支名 + worktree 双重保险（v21）
- 僵尸 worktree 检测（v22）
- .dev-mode 存在检查（v23）

### 根本原因
branch-protect.sh 随版本演进从 v17 到 v27 累积了大量检查逻辑。
其中 PRD/DoD 文件存在检查、内容验证、数据库检查等功能与 CI L1 完全重复。
本地 hook 的职责应仅限于"能否写代码"的快速门控（分支名、worktree、.dev-mode）。
冗余检查导致文件膨胀到 998 行，增加了维护成本和 hook 执行时间。

### 下次预防
- [ ] 新增本地 hook 检查前先确认 CI 是否已覆盖，避免重复
- [ ] hook 文件超过 300 行时触发精简审查
