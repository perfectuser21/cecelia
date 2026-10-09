## 承诺地图格子镜子换库——旧 Backbone-Step Map 在回收站（2026-09-27）

### 根本原因
- 注册表 450 登记的 Backbone-Step Map 库 `369c…` 2026-09-19 被人放进 Notion 回收站；Notion API 对回收站里的库 **GET 返回 200、POST/PATCH 返回 404 "Could not find database… shared with your integration"**——报错文案指向"未共享"，真因是 `in_trash: true`。
- 守夜 A10 只比行数（Brain 3 vs Notion 0 也只是"对不上"），没有"库还活着吗"的探活；推送侧对无 notion_id 行的 404 只 failed++ 记日志，不会自愈也不会升级。
- AI Journey / AI Feature 镜子库同日进回收站，`journeys.notion_id` 全指向死页，任何 relation 到它们都会 404。

### 下次预防
- [ ] 排 Notion 写入 404 先查 `GET /databases/<id>` 的 `in_trash` / `archived`，再怀疑集成共享；报错文案不可信。
- [ ] 换库走机器路径：`scripts/ops/create-*-notion-dbs.js` 在「数据落脚总台账」页下按 title 幂等建 + 迁移改登记 + 常量同步（A9），旧行 archived/none 退出 A10。
- [ ] 建 relation 列前先确认目标库不在回收站；不确定就投文本，别让一列拖死整库写入。
- [ ] 记账列清零重推前算一下量（286 行 / 每轮 50 = 30 分钟），LIMIT 是防洪闸不是摆设。
- [ ] 守夜缺一条「镜子库探活」断言（in_trash → 红），另立任务。
