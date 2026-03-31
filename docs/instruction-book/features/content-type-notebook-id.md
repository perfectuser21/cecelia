# 内容类型 notebook_id 绑定

## 功能说明

每个内容类型可以绑定一个 NotebookLM 项目 ID（`notebook_id`），用于后续内容生成时调用 NotebookLM API。

## 使用方式

### 1. 在内容类型配置页管理

访问 `/content-factory/config` → 内容类型配置页，可查看所有内容类型并编辑各自的 `notebook_id`。

- 每个类型显示当前来源（`DB` = 已覆写，`YAML` = 使用默认值）
- 填入 NotebookLM 项目 ID 后点击"保存"即写入数据库

### 2. 创建 Pipeline 时自动填入

在内容工厂（`/content-factory`）创建 Pipeline 时，选择内容类型后会自动从配置读取并填入 `notebook_id` 输入框，无需手动输入。

### 3. Pipeline 步骤详情展开

内容工厂的 Pipeline 列表中，点击任意 Pipeline 卡片可展开查看各阶段（研究/文案/审核/生成/图片审核/导出）的实时状态、耗时和失败原因。

## API

- `GET /api/brain/content-types/:type/config` — 读取指定内容类型的完整配置（含 notebook_id）
- `PUT /api/brain/content-types/:type/config` — 更新内容类型配置（写入 DB，优先于 YAML）
- `POST /api/brain/pipelines` — 创建 Pipeline，可传 `notebook_id` 字段
- `GET /api/brain/pipelines/:id/stages` — 获取 Pipeline 各阶段详情（含 summary 失败原因）
