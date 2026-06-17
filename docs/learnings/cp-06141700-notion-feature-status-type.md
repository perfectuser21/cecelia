# Learning — Notion Feature 推送 Status 属性类型修复

## 根本原因

`notion-push-sync.js` 的 `pushJourneyFeatures` 把 feature 的 `Status` 当 Notion `select` 类型发送（`Status: { select: { name } }`），但 Notion「AI Feature」库的 Status 属性实际是 **status 类型**。类型不符 → Notion POST /pages 返回 400「Status is expected to be status」。

放大因素：feature push 的 catch 块只对 `isStaleRelationError`（404 死关联）标记 `notion_synced_at=NOW()` 止血，对该 400 类型错不标记 → 88 个 feature 每轮 sync 无限重试，近 1 小时 120 次失败 + 日志风暴。

#3371「Brain↔Notion 属性映射修复」当时修了 Title/Order/initiative_id 的降级，但漏了 feature 的 Status 类型——属性映射的修复没有覆盖全部属性类型。

实测 Notion Feature 库 schema 确认：Status status 类型的合法选项（planned/working/building/broken/deprecated/done）与 DB 的 6 个 status 值一一匹配，故仅类型需对齐，值无需映射。附带 Kind 是 select 类型但 Notion 选项首字母大写（Ability/Feature），DB 存小写 → select 自动建重复小写选项，一并修正映射。

## 下次预防

- Notion 属性映射改动后，必须对每个被写的属性核对 Notion 库 schema 的真实类型（status vs select vs rich_text），不能假设都是 select。
- 推送失败的 catch 应区分「可重试（瞬时网络）」与「永久（类型/选项不符）」——永久错误也应标记或告警，避免无限重试风暴。
- 属性映射类修复要列出该库所有被写属性逐一核对，而非只改报错的那一个。

## 预防清单

- [ ] 新增 Notion push 属性时，先 GET database schema 确认属性类型再构造 payload
- [ ] push catch 块对永久性 400（类型/选项不符）也标记 synced 或告警，不无限重试
- [ ] 属性映射修复 PR 在描述中列出该库全部被写属性及其 Notion 类型
