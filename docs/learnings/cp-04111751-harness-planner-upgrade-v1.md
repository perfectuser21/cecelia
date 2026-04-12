### 根本原因

harness-planner SKILL.md v4.1 的 Step 0 只读代码文件，没有采集业务上下文（Brain API）。PRD 模板缺乏结构化（无 User Stories/GWT/FR-SC 编号/OKR 对齐），歧义处理完全依赖手动提问。

### 下次预防

- [ ] changelog 条目中避免出现 "Step N"（不带连字符），否则会被 `Step\s*0[^]*?` 正则提前命中，导致 DoD 验证从 changelog 而非实际章节中提取内容
- [ ] 写完 SKILL.md 后立即用合同中的 DoD Test 命令逐条验证，不要等到 push 前才统一跑
- [ ] .dev-mode 文件格式必须是 `.dev-mode.{branch_name}`（branch-protect.sh v14+ 格式），不是无后缀的 `.dev-mode`
