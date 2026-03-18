# 内容类型添加指南

## 概览

Cecelia 内容工厂支持多种内容类型（如图文、视频号、信息图等），每种类型的配置通过 YAML 文件驱动。
新增内容类型**不需要修改任何代码**，只需在 `packages/brain/src/content-types/` 目录下添加一个 YAML 文件。

---

## 快速上手：3 步新增内容类型

### 第 1 步：创建 YAML 文件

在 `packages/brain/src/content-types/` 下新建 `<type-name>.yaml`，文件名即类型标识符。

```
packages/brain/src/content-types/
├── solo-company-case.yaml   ← 现有类型
└── your-new-type.yaml       ← 新建这个
```

**命名规范**：小写字母 + 连字符，如 `short-video`、`product-review`。

### 第 2 步：填写必填字段

```yaml
content_type: your-new-type   # 必须与文件名一致

images:
  count: 9                    # 生成图片数量（正整数）
  format: svg                 # 图片格式（svg/png/jpg）

template:
  generate_prompt: |          # 生成阶段提示词，{keyword} 是占位符
    基于调研报告，生成关于 {keyword} 的9张信息图。
    每张聚焦一个核心维度，包含数据图表和关键洞察。
  research_prompt: |          # 调研阶段提示词
    深度调研 {keyword}，包含市场规模、竞争格局、核心数据。

review_rules:
  - id: "data_accuracy"
    description: "数据来源可信，有具体数字支撑"
    severity: "blocking"      # blocking（必须通过）或 warning（警告）
  - id: "visual_clarity"
    description: "信息图清晰易读，重点突出"
    severity: "warning"

copy_rules:
  platform_tone:
    xiaohongshu: "口语化，活泼，多用感叹号"
    weibo: "简洁，数据驱动"
  max_length:
    title: 20
    caption: 200
```

### 第 3 步：验证格式

Brain 启动时会自动验证所有 YAML，也可以手动检查：

```bash
# 手动触发验证（Brain 需要在运行）
curl localhost:5221/api/brain/content-types
```

若返回你的新类型则说明注册成功。

---

## 必填字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `content_type` | string | 内容类型标识符，**必须与文件名完全一致** |
| `images.count` | number | 生成图片数量，必须为正整数 |
| `template.generate_prompt` | string | 内容生成阶段提示词，支持 `{keyword}` 占位符 |
| `template.research_prompt` | string | 内容调研阶段提示词（可选，但建议填写） |
| `review_rules` | array | 审查规则列表，可为空数组 `[]` |
| `copy_rules` | object | 文案规则，可为空对象 `{}` |

---

## review_rules 说明

每条规则的字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 规则唯一标识，用于日志和报告 |
| `description` | string | 人工审查时的检查说明 |
| `severity` | string | `blocking`（不通过则阻塞流程）或 `warning`（记录告警） |

---

## 完整示例：短视频内容类型

```yaml
content_type: short-video

images:
  count: 1
  format: jpg

template:
  generate_prompt: |
    为 {keyword} 创作一条 60 秒短视频脚本。
    结构：开头 hook（3秒）+ 核心内容（50秒）+ call-to-action（7秒）。
    语言口语化，适合 18-35 岁都市白领。
  research_prompt: |
    调研 {keyword} 相关热门短视频：
    - 最近30天的热门话题和 BGM
    - 竞品内容分析（TOP 10 视频）
    - 目标受众的评论关键词

review_rules:
  - id: "hook_quality"
    description: "开头3秒有强吸引力（问题/反常识/情绪触发）"
    severity: "blocking"
  - id: "cta_present"
    description: "结尾有明确的行动号召"
    severity: "warning"

copy_rules:
  platform_tone:
    douyin: "年轻化，节奏快，多用网络热词"
    xiaohongshu: "真实感强，像朋友推荐"
  max_length:
    title: 15
    caption: 150
```

---

## 相关代码

| 文件 | 作用 |
|------|------|
| `packages/brain/src/content-types/content-type-registry.js` | YAML 加载器，`getContentType()` / `listContentTypes()` |
| `packages/brain/src/content-types/content-type-validator.js` | 格式校验器，Brain 启动时自动调用 |
| `packages/brain/src/content-pipeline-orchestrator.js` | Pipeline 编排器，读取 YAML 配置驱动 content-generate / content-review |

---

## 常见问题

**Q: 新增 YAML 后 Brain 报 WARN 怎么办？**
检查 `content_type` 字段值是否与文件名完全一致（包括大小写和连字符）。

**Q: generate_prompt 中可以用哪些占位符？**
目前只支持 `{keyword}`，在 Pipeline 启动时自动替换为实际关键词。

**Q: review_rules 可以为空吗？**
可以，`review_rules: []` 是合法的，表示无需人工审查。
