## Brain {VERSION} — 仓库物件故障处置读写（技能工厂第③棒）

- `GET /enablers`（`/warehouse-items`）多返回 `shelf`、`failure_semantics`，`?keys=a,b` 一次取多件；`POST /enablers` 新建仓库物件（货架 / kind 按表约束校验，key 重复 409）；`PATCH /enablers/:key` 写故障处置（rows 非空、class 为 empty_ok / retryable / fatal / needs_human）；`GET /activity_uses?activity_id=` 取 Activity 依赖的物件及处置。
- `failure_semantics` 列为 text：按 JSON 文本存，读出能解析给对象、旧纯文本原样给；不改表结构。新增 enablers-failure-semantics smoke（写操作仅 CI 执行）。
