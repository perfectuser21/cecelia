## Workspace跨仓CI固定来源（2026-10-09）

### 根本原因
单repo固定SHA提取器不能把Workspace caller和Brain callee当作同一来源，永久协议测试实际读YAML也不等于中央已有消费者归属。

### 下次预防
- [x] 对每份来源保repo/revision/hash，用实际Git对象正负测试拒绝main别名、uses与tooling_revision错配、固定源码缺失、二次读回漂移。约束：scripts/ci/__tests__/workspace-ci-source-bundle.test.mjs。
- [x] AST核真实import绑定、相对URL、YAML.parse/readFileSync及被node:test调用的helper，字符串和死分支不能认领。约束：scripts/ci/__tests__/workspace-ci-source-bundle.test.mjs。
- [x] 固定既有F3七字段，冻结required caller-job、callee interface/tooling checkout与node源码；bundle仅consumer_evidence且executable=false，来源未证全四refs未知。约束：scripts/ci/__tests__/workspace-ci-source-bundle.test.mjs。

历史事实：最初51项本地回归通过（含后来删除的薄导出身份测试）；固定Workspace de3/Brain8916源码只读提取9bindings/9relations来源verified，不等于运行成功或中央登记。

- [x] 解析真身位于 packages/brain/src/lib/workspace-ci-source-bundle.js，CI与生产直接导入同一模块；薄导出已删。只依赖acorn/js-yaml，隔离目录排除eslint/espree真实导入。按实际Docker安装方式已验证解析依赖可加载，不需要另加依赖；候选源码仍须正式发布后才上服务器。

- [x] 新可选admission_scopes仅接受既有6输入加精确schema-v1字段；新双分支callee只按完整已审核字节hash与MODE/scopes环境确认，普通死shell仍拒。静态来源verified与trusted_main_history准入分离，中央准入仍unknown。

- [x] 候选凭据必须由实际cecelia_scratch身份与唯一core提取，private WeakSet授信，生产及复制重放拒绝。约束：packages/brain/src/__tests__/integration/existing-ops-registration.pg.integration.test.js。
- [x] 跨仓扫描各用实际固定Git源和不同图键；Workspace图不得写到Brain逻辑登记键，也不得把Brain YAML路径当Workspace依赖。约束：scripts/ci/implementation-snapshot.mjs 与上述真实PG测试。

本轮实际验证：Node 50/50、协议单元98/98、联合真实PG59/59。包含两Git来源提取、锁内追加、隔离导入/重建、分别扫描两仓，以及严格历史查询。候选完整pre-push、正式CI、生产部署与手机业务实跑仍需分别留实际证据。
