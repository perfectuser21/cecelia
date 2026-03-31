---
id: instruction-content-pipeline-claude
version: 1.0.0
created: 2026-03-31
updated: 2026-03-31
authority: USER_FACING
changelog:
  - 1.0.0: 初始版本 — 接通 content pipeline executor 的 Claude CLI 调用
---

# Content Pipeline Executor — Claude CLI 调用

## What it is

内容工厂 Pipeline 的 6 阶段 executor 中，4 个阶段（Copywriting / CopyReview / Generate / ImageReview）现在真正调用 Claude CLI 执行内容生成和审核，使用配置页面设置的 prompt。

文件：`packages/brain/src/content-pipeline-executors.js`

## 配置入口

**仪表盘** → 内容工厂 → 配置管理（`/content-factory/config`）

每种内容类型（如 `solo-company-case`）可独立配置各阶段 prompt：

| 阶段 | 配置字段 | 用途 |
|------|---------|------|
| Copywriting | `template.generate_prompt` | 生成社交媒体文案 + 公众号长文 |
| CopyReview | `template.review_prompt` | 审核文案，返回每条 rule 的评分 |
| Generate | `template.image_prompt` | 生成图片内容描述 |
| ImageReview | `template.image_review_prompt` | 审核图片描述 |

## Prompt 占位符

| 占位符 | 含义 |
|-------|------|
| `{keyword}` | pipeline 关键词 |
| `{findings}` | Research 阶段的调研素材 |
| `{copy}` | Copywriting 阶段的文案内容 |
| `{descriptions}` | Generate 阶段的图片描述 |
| `{rules}` | YAML 中定义的 review_rules 列表 |
| `{count}` | 图片数量（来自 images.count 配置） |

## Rerun 改进机制

当 CopyReview 失败后触发 rerun 时，Orchestrator 将审核 issues 作为 `review_feedback` 写入下一次 Copywriting 的 task payload。Copywriting 会自动在 prompt 末尾追加：

```
上一次审核反馈：{review_feedback}，请在此基础上改进。
```

## 返回结构

**executeCopyReview** 返回：
```json
{
  "review_passed": true,
  "rule_results": [{"id": "brand_voice", "passed": true, "score": 8, "comment": "..."}],
  "issues": []
}
```

**executeImageReview** 返回：
```json
{
  "review_passed": true,
  "issues": []
}
```

## Fallback 机制

所有 Claude 调用失败时（claude CLI 不可用、超时等），各函数有降级处理：
- `executeCopywriting`：写入占位文件，返回 `success: false`
- `executeCopyReview`：使用静态关键词/禁用词规则，返回 `fallback: true`
- `executeGenerate`：写入占位文件，返回 `success: false`
- `executeImageReview`：检查文件存在性，返回 `success: true`
