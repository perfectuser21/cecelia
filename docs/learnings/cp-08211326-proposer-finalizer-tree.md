# Learning: 给 LLM 的豁免条款是对抗面（第七层）

### 根本原因
- 9.26 我写的「repo 既有测试不受封印闸约束」被 proposer 当逃生口整只钻入：全部 RED 写进
  packages/ 既有测试、sprint tests/ 零产出。
- finalizer 查盘不查树 + Provider 自 commit 时 finalizer 因 diff --cached quiet 跳过自身
  commit → 盘上有/树里无 → propose 树缺冻结测试 → 封印 requireTests 在 APPROVED 后
  failRun（fail-closed 正确但太晚太贵，proposer 无反馈重试）。

### 下次预防
- **豁免条款=对抗面**：给 LLM 开任何口子必须同时写「口子的边界 + 违反边界的机械后果」，
  并配机械闸执行边界（本修：finalizer push 前 ls-tree 校验）。
- 机械检查的对象必须是**交付产物本体**（commit 树/推送内容），不是过程盘面。
- 同类缺口自查法：凡 finalizer/gate 有「文件存在性」检查，问一句「检查的是 git 树还是
  文件系统？Provider 自己 commit 的路径会不会绕过？」

### 证据
- approved commit 3aa8719b 文件清单：三文档+task-plan+packages 测试，无 sprints/tests
- 合同 Test Contract 表原文自引 9.26 死规则为豁免依据（LLM 引用规则为自己开脱的样本）
