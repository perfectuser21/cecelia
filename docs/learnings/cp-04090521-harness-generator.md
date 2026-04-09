### 根本原因

harness_generate 任务 cf53f3f8 执行时，sprint-contract.md（sprints/sprint-1）的全部 6 个 SC 均已满足：
- sprint-evaluator/sprint-generator skill 已部署到 ~/.claude-account1/skills/
- deploy-workflow-skills.sh 存在且可执行
- skills-index.md 包含 sprint-evaluator、sprint-generator 条目和路由
- scripts/deploy-local.sh 已包含 deploy-workflow-skills 调用

### 下次预防

- [ ] harness_generate 执行前先逐一验证 SC，已 PASS 则直接输出 DONE，不做多余变更
- [ ] sprint_dir 为占位符路径时，按 ./sprints/ 目录查找实际合同文件
