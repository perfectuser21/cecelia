# Learning: harness-planner SKILL.md changelog 触发 find 挂起

## 根本原因

harness-planner SKILL.md 的 changelog 中写了「改名 harness-planner（原 sprint-planner）」，导致 claude agent 在执行时主动搜索 sprint-planner 的 SKILL.md 文件，触发 `find /Users/administrator -name "SKILL.md" -path "*/sprint-planner/*"` 命令，该命令扫描整个主目录耗时 3+ 小时无法终止，最终导致任务超时失败（0 bytes output）。

## 下次预防

- [ ] SKILL.md changelog 不写「原 xxx」/ 改名引用，只写当前版本定义
- [ ] SKILL.md 顶部添加执行规则注释：「不要搜索/查找其他 skill 文件，直接按本文档流程操作」
- [ ] 新 skill 部署到 account1 必须在 deploy-workflow-skills.sh 后验证软链接存在
