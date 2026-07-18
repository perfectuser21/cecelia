# Learning: 刀A1 总关系图进照相层

### 根本原因
索引服务(locate/related/radius/island-check/claim-status)缺数据层:"谁连谁"散在 import/spawn/http 三种载体里,没有任何一张机器可查的表。刀0 只复活了"存在什么"(api/db_schema/test 三照片),没有"谁连谁"。

### 下次预防
- [ ] 无自然键的 derived 数据(边、快照类)一律全量替换语义(事务内 DELETE+INSERT),禁 upsert 积死边——scan-api-registry 的 upsert 不删失效行是已知缺陷,新扫描器不复制
- [ ] schema 版本锚一共五处(selfcheck.js + 两个测试断言 + DEFINITION.md 两处),bump 必须同 commit 全改;desire-system.test.js 已豁免别多改
- [ ] 新增 migration 后生产库必须在部署前/后立即 migrate,否则 selfcheck 锚告警;本地一律先 scratch 验
