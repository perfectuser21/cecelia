# Learning: fix-pipeline-issues

## 分支
`cp-03301744-fix-pipeline-issues`

## 问题描述
content-pipeline 点击「执行」后立即失败，且 UI 只显示「失败」没有任何原因说明。

### 根本原因
1. **文章模板过短**：无 notebook_id 时 fallback article 模板渲染后约 1058 字，但 `solo-company-case.yaml` 配置 `min_word_count.long_form: 1500`，copy-review 的长度检查必然 FAIL
2. **失败原因不落库**：`_executeStageTask` 只更新 `status` 和 `completed_at`，`execResult.issues` 从未写入 DB，stages API 只能返回状态，无法告知用户为何失败
3. **配置与实现解耦后未同步**：YAML 的 min_word_count 配置是后加的，但 fallback 模板是早期硬编码的，两者维护分离，导致长期不一致

## 修复
1. 扩展 `fallbackArticleSections` 3 个段落，渲染后从 1058 字增至 ~1564 字（通过 ≥1500 阈值）
2. `_executeStageTask` 完成时，当 `execResult.issues !== undefined` 时用 `payload || jsonb` 把 `review_issues`/`review_passed` 写入 task
3. `GET /:id/stages` SELECT 中加 `payload->'review_issues'` 并在响应中包含该字段

## 下次预防
- **fallback 模板要和 YAML 阈值一起验证**：每次修改 copy-review 规则或 min_word_count，应同步检查 fallback 模板的渲染长度
- **executor 返回的所有关键字段都应持久化**：review_passed、issues、score 等运行时结果写入 payload，不只更新状态字段；否则 stages API 永远是盲的

## 行动项
- [ ] 给 content-pipeline executor 的集成测试加一条：验证 copy-review 失败时 stages API 返回 review_issues 非空
- [ ] solo-company-case.yaml 的 min_word_count 配置应有注释说明 fallback 模板必须满足此阈值
