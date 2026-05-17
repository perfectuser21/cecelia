# Content Pipeline LLM 调用

## 功能概述

content-pipeline-executors.js 的四个阶段现在通过 `callLLM` 调用 Claude，生成真实 AI 内容。

## 各阶段行为

| 阶段 | LLM Prompt 来源 | 输出 |
|------|----------------|------|
| `executeCopywriting` | `typeConfig.template.generate_prompt` | 社交媒体文案 + 公众号长文 |
| `executeCopyReview` | `typeConfig.template.review_prompt` | `rule_scores[]` 逐条评分 |
| `executeGenerate` | `typeConfig.template.generate_prompt` | `cards/llm-card-content.json` 卡片描述 |
| `executeImageReview` | `typeConfig.template.image_review_prompt` | 质量分 + 审核意见 |

## Rerun 行为

第二次 rerun 时，若 `task.payload.previous_feedback` 存在，会自动注入到 copywriting prompt 中（"上次审查意见"）。

## Fallback 机制

任何阶段 `callLLM` 调用失败时，自动降级到原有静态逻辑，不中断 pipeline。返回结果中 `llm_generated/llm_reviewed/llm_content` 字段为 `false` 标示降级状态。

## Prompt 热更新

prompt 存储在 content type 配置中（DB 或 YAML），修改后下次执行立即生效，无需重启服务。
