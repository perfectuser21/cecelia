# Learning: harness-skills SKILL.md changelog 改名引用导致 find 挂起

## 根本原因

4 个 harness SKILL.md（contract-proposer/reviewer/generator/report）的 changelog 中写了「改名 harness-xxx（原 sprint-xxx）」，导致 agent 主动搜索旧 sprint-xxx SKILL.md 文件，触发 `find /Users/administrator -name "SKILL.md" -path "*/sprint-xxx/*"` 命令扫描整个主目录，挂起 3+ 小时无法终止。

## 下次预防

- [ ] SKILL.md changelog 不写「原 xxx」/ 改名引用，只写当前版本定义
- [ ] SKILL.md 顶部添加执行规则注释：「不要搜索/查找其他 skill 文件，直接按本文档流程操作」
- [ ] 新 skill 部署前检查 changelog 无旧 skill 引用
