# Cecelia 固定 Git 读取修复验收

Task: 95b9c92b-45f8-477d-bbdf-e4d787321ecd
Parent Task: 7f20d546-8f15-46ac-8d98-fc5361412c33
Routing Receipt: df9eadc5-4b8f-4258-86ce-975078cd5010
GP-Anchor: none(infra)

- [x] 同一对账闭包冷启动核对 19 个固定文件，仅请求一次 commit、一次 tree 和 19 个 blob。
  Test: manual:npm test --workspace packages/brain -- src/lib/workflow-assembly-native-source.test.js
- [x] 已登记与部署提交相同时，保留固定源码读取错误并拒绝重复读取。部署提交不同时，独立核验。
  Test: manual:npm test --workspace packages/brain -- src/lib/workflow-assembly-native.test.js
- [x] 读取返回 403 时保留 Git 读取错误。成功读取的坏 JSON 仍报告解析错误。
  Test: manual:npm test --workspace packages/brain -- src/workflow-authoring/freeze.test.js
- [x] Brain 版本文件同步。
  Test: manual:bash scripts/check-version-sync.sh

本地 Git 和数据库边界夹具覆盖上述验收。托管 CI、实际发布及生产额度读回需在发布前后分别确认。
