---
branch: cp-03301108-pr-review-deepseek
date: 2026-03-30
task: CI 接入 DeepSeek PR 自动 Review
---

# Learning: CI 接入 DeepSeek PR 自动 Review

### 根本原因

branch-protect.sh 要求 `.dev-mode` 文件包含 `tasks_created: true` 字段，否则拒绝所有代码写入操作。
在 Stage 1 生成 .dev-mode 时未包含此字段，导致第一次 Write 被拦截，需要重新写入 .dev-mode 后才能继续。
此外，DoD 映射检查器（check-dod-mapping.cjs）要求 `Test:` 字段不带反引号，纯文本格式，写成 `\`manual:...\`` 会导致正则不匹配而误报"缺少 Test 字段"。

### 关键决策

- 使用 OpenRouter 作为 API 网关（而非直接 DeepSeek API），因为用户已有 OPENROUTER_API_KEY secret
- 模型选用 `deepseek/deepseek-chat-v3-5`（任务明确指定）
- sys-prompt 强调中文输出 + 关注逻辑/安全/DoD 三个维度，与 Cecelia 开发流程对齐
- workflow 设置为 advisory only（不阻塞合并），避免 API 故障影响正常开发流程

### 下次预防

- [ ] 生成 .dev-mode 文件时，立即包含 `tasks_created: true`，避免 branch-protect.sh 二次拦截
- [ ] 使用外部 Action（如 `hustcer/deepseek-review@v1`）时，先确认其参数 schema（`chat-token` vs `api-key`）
- [ ] PR review workflow 建议设置 `timeout-minutes` 防止 API 超时卡死 runner
