---
skeleton: false
journey_type: user_facing
---
# Contract DoD — 系统总图页上线

**范围**: Dashboard `/map` 页面与 planning feature manifest 路由、mind-elixir 依赖；不改 map API。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] planning feature manifest 唯一注册 `/map` 与 `MapPage`，system-hub 不重复注册。
  Test: `(cd apps/dashboard && npx vitest run --no-cache src/pages/map/MapPage.test.tsx)`
- [ ] [ARTIFACT] Dashboard 依赖清单登记 `mind-elixir`，且源码无 rebuild 公共入口。
  Test: `node -e "const p=require('./apps/dashboard/package.json');if(!p.dependencies['mind-elixir'])process.exit(1)"`

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L3] B-01: 从 system-hub 打开页面后显示真实 manifest、freshness 与 API 节点计数 [接缝×2]
  动作: 浏览器打开 system-hub，点击系统总图入口，并同时读取真实 cecelia map API。
  预期观察: 页面显示通用地图、Manifest 版本、freshness 徽标及与 API 相同的 Capability 数量。
  等待预算: 10s
  留证: `sprints/08240802-kernel-b3da4db6/screenshots/staging-map-initial.png` 与 Playwright 输出。
  Test: manual:bash -c 'awk '\''/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'\'' sprints/08240802-kernel-b3da4db6/contract-draft.md >/tmp/map-contract-e2e.sh && bash /tmp/map-contract-e2e.sh'

- [ ] [BEHAVIOR] [L3] B-02: 三层图包含价值流、能力、特性、证明及交接关系 [接缝×2]
  动作: 在页面展开一个 Capability 并继续打开 Assertion 证据。
  预期观察: Feature、证明数/覆盖条、receipt、横切件与 hands_off_to 交接均可见。
  等待预算: 10s
  留证: `sprints/08240802-kernel-b3da4db6/screenshots/staging-map-initial.png` 与 Playwright DOM 断言输出。
  Test: manual:bash -c 'awk '\''/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'\'' sprints/08240802-kernel-b3da4db6/contract-draft.md >/tmp/map-contract-e2e.sh && bash /tmp/map-contract-e2e.sh'

- [ ] [BEHAVIOR] [L3] B-03: 双 scope 切换与搜索只展示最终匹配层级 [接缝×2]
  动作: 搜索一个真实 Capability，再快速切换 cecelia 与 zenithjoy-workspace 并加载。
  预期观察: 搜索保留匹配节点祖先；最终视图 scope 等于最后选择且不残留旧 revision。
  等待预算: 10s
  留证: `sprints/08240802-kernel-b3da4db6/screenshots/staging-map-search.png` 与 `staging-map-scope.png`。
  Test: manual:bash -c 'awk '\''/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'\'' sprints/08240802-kernel-b3da4db6/contract-draft.md >/tmp/map-contract-e2e.sh && bash /tmp/map-contract-e2e.sh'

- [ ] [BEHAVIOR] [L2] B-04: 非 fresh、请求失败、空投影与无搜索结果均 fail closed
  动作: 执行本 sprint 冻结测试，以可控响应覆盖 stale、HTTP 失败、空 nodes、无匹配及竞态响应。
  预期观察: 显示明确警示/空态，旧 scope 节点被清除，非 fresh 不显示成功态。
  等待预算: 10s
  留证: 冻结 Vitest 的逐用例输出，包含五个字面测试名。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08240802-kernel-b3da4db6/tests/map-page-contract.test.ts --reporter=verbose'

- [ ] [BEHAVIOR] [L2] INV-1: 实现基线、分支与验证命令纪律未回退
  动作: 核查当前提交祖先、工作分支与冻结测试执行结果。
  预期观察: 实现基线是祖先、分支非 main，Vitest 解释器真实启动并返回真实 exit code。
  等待预算: 30s
  留证: git 与 Vitest 命令输出。
  Test: manual:bash -c 'test "$(git branch --show-current)" != main && git merge-base --is-ancestor 6cc74f728b9c515cf67130a9b06b20e03d651772 HEAD && (cd apps/dashboard && npx vitest run --no-cache ../../sprints/08240802-kernel-b3da4db6/tests/map-page-contract.test.ts)'

## Invariant 映射

- 分支权威：INV-1；proposer 未切换 planner workspace，当前为服务端签发 propose branch。
- 禁止写死：页面数据来自 API；环境 URL 仅使用 PRD 明示 localhost 目标。
- 真环境验证：B-01/B-03 为 mac_web L3，未真验前状态为 `logic-done-pending`。
- 测试隔离：N/A，本 sprint 不读写租户数据。
- 凭据安全、日志脱敏：无 secret/PII 输入；E2E 不输出身份变量值。
- 端点鉴权、租户隔离：N/A，本 sprint 不新增或修改 API/租户查询。
- 验证命令：INV-1 实跑 Vitest 并传播 exit code。

## 接缝清单

- 浏览器 ↔ localhost:5174 ↔ Brain 同源 map API：mac_web Final E2E 真请求并截图；未通过前 `logic-done-pending`。
- scope 状态 ↔ 异步 fetch 响应：快速切换重复 2 次，最终 DOM 与最后响应核对；未通过前 `logic-done-pending`。

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E:screenshot] Final E2E 截图位于 `sprints/08240802-kernel-b3da4db6/screenshots/`，包含初始、搜索与 scope 切换结果，并由视觉自验确认无旧数据残留。
