# 独立裁判（第 2 轮）

- 裁决：**FAIL**（contract_gap）
- 模型：gpt-5.6-sol
- 复核的 QA 报告：05-qa-report-r2.md
- 总评：ai 判定点的写入和查询已有真实预览环境证据，普通扩展枚举的保留及重跑幂等也已验证。但合同指定的解析算法会静默遗漏部分合法扩展取值，未完全实现“只增不减”；应修订合同并补验后再合并。

## 需求覆盖

### I-1
- 满足
- 依据：迁移文件 packages/brain/migrations/552_decisions_made_by_allow_ai.sql:46-60 将 ai 加入取值并集并重建约束。QA T-1 在预览 Brain 上提交完整 coding-workflow 判定点 shape，实际输出 HTTP 201、success:true、made_by:"ai"、category:"judgment"；随后 GET ?category=judgment 查回恰好一行，author 为 coding-workflow。T-4 的两次重复提交均返回 201，并查回两行 ai 数据。T-7 查询同一预览库，确认迁移 552 已记录且唯一 made_by CHECK 包含 ai。合同 S-1、S-3、Q-1、Q-4 覆盖该需求。

### I-2
- 未满足
- 依据：QA T-5 真实执行两次 migrate，证明普通扩展值 qa_extra 被保留，D1 与 D2 完全相同，两次退出码均为 0，schema_version 中 552 恰好一行；T-6 证明列类型和默认值不变；T-7 证明预览克隆库当前存量取值均在新约束中。但合同指定的正则抽取算法不能完整保留合法的迁移外枚举值，现有代码和 QA 均未覆盖这一缺口，见 J-1。

## 问题

### J-1
- 类型：contract_gap
- 严重度：重要
- 对应：I-2
- 位置：02-spec.md:S-1、S-2、Q-5；packages/brain/migrations/552_decisions_made_by_allow_ai.sql:33-40；05-qa-report-r2.md:T-5、T-7
- 说明：S-1 强制使用 regexp_matches(def, '''([^'']+)''::', 'g') 提取枚举值，这与 I-2 的“迁移外加宽的取值全部保留”不完全相容。合法的 IN 约束可以包含空字符串或含单引号的取值，例如在原三值之外增加 ''、'owner''x'。该正则的 + 不匹配空字符串，也不能解码 SQL 的双单引号转义：'owner''x' 会被抽成 x。由于原三值仍能匹配，代码不会触发无法解析异常，而会成功删除旧约束、建立遗漏这些合法取值的新约束并记录 552。使用这些迁移外取值的用户之后写入或更新 decisions 会遭遇约束拒绝；NOT VALID 仅避免扫描存量，不能保留其后续可写性。代码照用了合同指定算法，因此应修订合同的取值解析要求，并补充真实数据库验收，而不能仅要求开发方违背规格修改。T-5 只验证 qa_extra，T-7 的存量值也只有普通三值和 ai，均不能证明这些合法扩展值被保留。
