# DoD：Nightly现役workflow权限拒绝夹具

- [x] [BEHAVIOR] 权限变异使用实际现役ci.yml及唯一顶层只读权限锚点；私有Git只改一个workflow的一行contents权限，完整YAML等价断言保留。
  Test: manual:POSTGRES_INTEGRATION=1 npx vitest run --config ../../scripts/ci/deep-integration.config.mjs src/__tests__/integration/native-consumer-source-selection.pg.integration.test.js
- [x] [BEHAVIOR] 篡改后的当前来源必须unknown且无bindings/relations，当前登记拒绝，历史current及地图零写；同文件历史正例和其他代际选择测试全部保持真实PG通过。
  Test: manual:POSTGRES_INTEGRATION=1 npx vitest run --config ../../scripts/ci/deep-integration.config.mjs src/__tests__/integration/native-consumer-source-selection.pg.integration.test.js
