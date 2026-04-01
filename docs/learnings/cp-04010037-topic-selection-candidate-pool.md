# Learning — 选题决策闭环 v1 实现

**分支**: cp-04010037-019a2866-b93d-436d-82e1-46b51a  
**任务**: 019a2866-b93d-436d-82e1-46b51ad213fe

### 根本原因

`content_topics` 表存在了很久，但 AI 选题调度器（`topic-selection-scheduler.js`）从未向它写入数据。每日选题直接进 `topic_selection_log` + 创建 `content-pipeline` tasks，候选库永远为空，无法对接内容发布链路。

### 修复方案

在调度器创建 tasks 之前插入步骤 4a/4b：
1. 每个选题写入 `content_topics`（填 source='ai_daily_selection', ai_score, score_reason）
2. 按 ai_score DESC 自动采纳 top 5（UPDATE status='adopted'）
3. 新增两个 API 端点：`GET /topics` 和 `GET /topics/today`
4. Migration 209 添加 `source VARCHAR(100)` 列

### 下次预防

- [ ] **合约测试切片陷阱**：用 `src.indexOf('});', routeStart)` 切路由体时，若路由内有 `{ key: 'val' });`（如 `toLocaleDateString` 的选项对象），会提前截断。用 `src.slice(routeStart)` 替代，检查全文件更简单可靠。
- [ ] **Sprint Contract dod_item 匹配**：Generator 和 Evaluator 的 `dod_item` 字符串必须完全一致（含/不含 `[TAG]` 前缀），否则 sprint-contract-loop.sh 报 "not found"，误认为 blocker。
- [ ] **worktree 中缺少 node_modules**：worktree 的 `packages/brain/node_modules` 不会自动生成，运行测试前须先 `npm install --workspace=packages/brain`。
- [ ] **check-dod-mapping 扫全文件**：`## 成功标准` 里的 `- [ ]` checklist 也会被当成 DoD 条目扫描，需要 Test: 字段或改成非 checklist 格式。
