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

## YAML 默认配置

每个内容类型的 YAML 文件可以直接预设 `notebook_id`，Orchestrator 会在创建 research 子任务时自动将其注入 payload，无需用户在前台手动填写。

```yaml
# packages/brain/src/content-types/solo-company-case.yaml
notebook_id: "1d928181-4462-47d4-b4c0-89d3696344ab"  # 固定工作区，每次 export 后清空 sources
```

这样，用户在内容工厂创建 Pipeline 时，选择该内容类型后 notebook_id 字段会自动填入，也可不填（由 YAML 配置兜底）。

## Notebook 复用模式（清空后复用）

每个内容类型固定绑定一个 NotebookLM 工作区 notebook：

1. **research 阶段**：orchestrator 将 `notebook_id` 传入 research 子任务，用于查询对应 notebook
2. **export 阶段完成后**：`executeExport` 自动调用 `listSources` + `deleteSource` 清空该 notebook 的所有 sources
3. **下次使用**：notebook 已清空，可直接复用，无需重新创建或手动清理

这样同一个 notebook 可以作为"一次性工作区"反复使用，避免 sources 堆积。

## API

- `GET /api/brain/content-types/:type/config` — 读取指定内容类型的完整配置（含 notebook_id）
- `PUT /api/brain/content-types/:type/config` — 更新内容类型配置（写入 DB，优先于 YAML）
- `POST /api/brain/pipelines` — 创建 Pipeline，可传 `notebook_id` 字段
- `GET /api/brain/pipelines/:id/stages` — 获取 Pipeline 各阶段详情（含 summary 失败原因）
