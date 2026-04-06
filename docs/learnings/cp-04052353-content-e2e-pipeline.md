# Learning: 内容产出端到端流程 — 质量验证层 + 模板扩充

## 任务背景
PR: 打通数据→选题→内容生成→发布完整闭环 v1

## 实现内容
1. 新增 2 个 AI一人公司主题内容类型（ai-tools-review / ai-workflow-guide）
2. content-quality-validator.js — 程序化字数/关键词/语气验证
3. POST /pipelines/:id/pre-publish-check — 发布前质量门禁
4. POST /pipelines/e2e-trigger — 端到端链路触发端点
5. 修复 migration 215 号冲突（content_analytics vs topic_suggestions → 后者升为 216）

---

### 根本原因
**migration 号冲突**：两个并行 PR（数据闭环 #1945 + 选题闭环 #1942）分别创建了 215_content_analytics.sql 和 215_topic_suggestions.sql，
导致 facts-check 失败（migration_conflicts 检查）。

**质量验证缺失**：现有 review_rules 只是 YAML 元数据，由 LLM 执行 → 运行时没有程序化的字数/关键词/语气检查层。

---

### 下次预防
- [ ] 并行 PR 合并前需检查 migrations/ 目录最高编号，新建时取 max+1（不能凭记忆）
- [ ] 内容类型新增时，`keywords_required` 至少配置 2 个品牌关键词，与 `minKeywordsHit=2` 逻辑保持一致
- [ ] `minKeywordsHit` 应取 `Math.min(2, keywords.length)` 避免关键词少时永远失败
