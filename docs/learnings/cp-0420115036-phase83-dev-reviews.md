# cp-0420115036-phase83-dev-reviews — Learning

### 背景

Phase 8.3：Structured Review Block 落 Brain（dev_reviews 表 + API）+ PR LOC 阈值 API 化（proxy / harness-planner 统一读 capacity-budget.pr_loc_threshold）。

### 根本原因

Phase 8.1 建的两个机制都"只做了前半段"：
1. Structured Review Block 规范只写在 proxy.md 里，review 生成后只进 design doc——**没有结构化存储、无法查询质量分趋势、无法对比 confidence 分布**
2. PR 行数双阈值（软 200 / 硬 400）硬编码在 proxy.md 和 A.B-2 prompt 里——**harness-planner 不读、capacity-budget API 不暴露，两处规则有漂移风险**

用户明确要求"Structured Review Block 规范落地到 Brain（Phase 8.3），替代'打分'的口头约定"。今天这个 PR 把两件事的"后半段"补齐：SSOT 放在 Brain 的常量文件 + 数据库表。

### 下次预防

- [ ] 任何"规范/约定"建立：必须同时建立"存储 + 查询 + SSOT"三件套；只写 markdown 规范不落地的 = 没建立
- [ ] 任何阈值/常量：SSOT 必须在一个代码文件里（`packages/brain/src/constants/` 下），**不得散落在多个 markdown 或 prompt 里**
- [ ] Brain 新表：migration 编号找 `ls migrations | tail -3` 确认最新号码不冲突
- [ ] review-parser 这类 markdown 解析器：测试必须覆盖"缺字段 / 空输入 / 格式错乱 / 中英混用"四个边界，不然线上会有解析失败
- [ ] CI workflow 对 empty commit / close-reopen **不触发**；要让 PR 重新过 CI 必须改一个实际文件内容 + push
