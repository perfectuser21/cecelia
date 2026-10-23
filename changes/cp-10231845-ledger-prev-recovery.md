## Brain {VERSION} — 失败发布的官方previous标签恢复收账

- 仅原pending.previous完整镜像ID与完整SHA匹配时，恢复接受官方 `prev-<健康版本>-<SHA前12位>` 标签及历史canonical标签；reconcile与pending rollback复用同一严格规则。
- recovered只清原pending，不添加成功史；新鲜pending、未知镜像、健康身份变化、非精确标签继续拒绝。无pending的新rollback与正式success仍要求canonical标签。
- 固定来源只新增独审过的ledger精确摘要并保留旧摘要；未知字节仍不准入。永久回归已纳入既有image-retention CI测试入口。
