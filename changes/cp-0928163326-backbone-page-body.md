## Brain {VERSION} — Backbone Activities 契约写入 Notion 页面正文（任务 d852c852）

- `backbone-contract-sync` 每轮在推属性后重写页面正文：只读提示（链回 git 正本）→ 对外承诺 → 输入输出 → 开工前提 → 做完怎么判定 → 步骤 → 出错怎么办 → 预算与限额 → 副作用与模型 → 已知缺口 → 负责人/执行/版本/指纹
- 正文完全由 `journey_steps.contract` 生成、单向只读；迁移 483 加 `notion_body_digest`，指纹不变不打 Notion，变了整段替换（每轮最多 3 页）；属性列本次不动
