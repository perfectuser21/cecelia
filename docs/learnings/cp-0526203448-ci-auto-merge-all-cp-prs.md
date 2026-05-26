## CI auto-merge 扩展到所有 cp-* PR（2026-05-26）

### 根本原因
stop hook 删除后，手动 /dev PR（无 harness label）失去自动合并能力。CI auto-merge job 的 harness label 门禁是历史遗留，与当前架构不匹配。

### 下次预防
- [ ] 删除基础设施组件时，同步检查依赖它的所有下游机制（stop hook 删了，CI auto-merge 的 label 判断也要同步更新）
- [ ] 新 /dev 分支 PR 创建后，若 CI 绿但没自动合并，先检查 auto-merge job 的触发条件
