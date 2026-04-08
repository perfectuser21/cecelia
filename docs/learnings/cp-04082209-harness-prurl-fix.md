### 根本原因

Harness E2E v3 中 Generator 完成后，execution-callback 链条未创建 harness_ci_watch。  
根本原因：execution.js 的 pr_url 提取逻辑只检查了 `result.pr_url` 和 `result.result.pr_url`（后者是字符串，无属性），没有处理 Generator 最终消息为 "**PR #2074**: ..." 格式文本的情况。

同时，harness-generator SKILL.md Step 6 描述不够强制，实际运行输出了人类可读文本而非 JSON verdict。

### 下次预防

- [ ] Generator 最终消息格式：SKILL.md 已更新为明确要求"纯 JSON，禁止其他文字"
- [ ] execution.js pr_url 提取现在有 6 层 fallback：payload→result顶层→result.result JSON解析→完整URL正则→PR#正则构造URL→DB pr_url列
- [ ] 层次 4.5（PR# 提取 + git remote 构造 URL）覆盖了 Generator 输出 "PR #XXXX" 格式的情况
