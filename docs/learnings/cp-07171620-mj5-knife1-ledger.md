# Learning: MJ5 刀1 账本落库

### 根本原因
承诺地图只存在于 artifact 页面，机器不可读：journeys/journey_steps/journey_step_links 缺 home/promise/格子维度，导致锚点闸（刀2）与联动清单（刀3）无账可查。

### 下次预防
- [ ] 删 UNIQUE 约束前全仓 grep `ON CONFLICT`——本刀 journeys.js 旧 upsert 若不同步改，生产 POST 必 500（对抗审查抓获）
- [ ] 给 journey_step_links 之类同步表加行为时，先查 notion-push-sync 的 WHERE 是否会放行新行
- [ ] seed migration 必须空库自足+固定 UUID 幂等（CI brain-integration 空库全量跑 migrate）
- [ ] 本地跑 migrate/集成测试死规矩 `DB_NAME=cecelia_scratch`——db-config 不认 DATABASE_URL，漏设=静默打生产库（本刀实弹：审查代理把 347 误打进生产，单事务补偿回滚至 346 零损伤；已立 Notion P1 建议 migrate.js 加生产库名护栏）
- [ ] worktree 收割器第 6 次犯病（干净 worktree 元数据被清）——修复=主仓重建 .git/worktrees/<name>/{gitdir,HEAD,commondir} + git read-tree HEAD（不带 -u）
