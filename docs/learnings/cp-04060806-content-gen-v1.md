## 内容生成 v1 — AI 每日产出引擎修复

### 根本原因

1. **executeResearch 硬失败**：`notebook_id` 未配置时直接 `return {success:false}` 终止 pipeline，而非降级到 LLM 研究。递归任务"AI内容生成每日任务"因无 `content_type` 导致注册表找不到 `notebook_id`，pipeline 每天必失败。

2. **orchestrator 无默认 content_type**：`_parsePipelineParams` 返回 `content_type: null`，`getContentType(null)` 得不到 `notebook_id`，子任务 payload 缺失关键字段。

3. **无每日产出统计 API**：KR "日均成功产出3条以上" 无法通过 API 直接验证，只能查原始任务表。

### 修复内容

- `executeResearch`：无 `notebook_id` 时新增 `_executeResearchViaLLM` 路径，直接调用 LLM 生成调研素材，pipeline 可继续推进。
- `_parsePipelineParams`：引入 `DEFAULT_CONTENT_TYPE = 'solo-company-case'`，任何未配置内容类型的 pipeline 任务自动获得默认注册表配置（含 `notebook_id`）。
- `GET /api/brain/pipelines/daily-stats`：新增接口，返回指定日期的 `{completed, in_progress, failed, queued}` 数量，可直接验证 KR 达成情况。

### 下次预防

- [ ] 新增 executor 时，必须显式处理"必须配置"参数缺失的情况：要么提供降级路径，要么用 `DEFAULT_X` 常量保底，禁止直接失败。
- [ ] 递归任务创建时，payload 必须包含 `content_type`（见 recurring_tasks 表 payload 字段），否则会绕过所有类型配置。
- [ ] 每个 Brain 产出类 KR 都应有对应的 `/api/brain/pipelines/daily-stats` 类型接口，方便自动验证。
