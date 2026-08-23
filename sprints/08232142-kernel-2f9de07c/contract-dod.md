---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Dashboard 系统总图页

**范围**: Dashboard 呈现层、dynamic planning manifest 入口和自动化测试；不改 Brain map 投影或响应契约。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/features/planning/pages/MapPage.tsx` 提供系统总图页面，且 `/map` 仅由 planning manifest 注册。
  Test: node -e "const fs=require('fs');const p='apps/api/features/planning/pages/MapPage.tsx';if(!fs.existsSync(p)||!fs.readFileSync(p,'utf8').includes('/api/brain/map?scope='))process.exit(1)"
- [ ] [ARTIFACT] frozen sprint test 与既有 Dashboard 回归测试进入 CI。
  Test: npx vitest run --no-cache sprints/08232142-kernel-2f9de07c/tests/map-page.contract.test.ts

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 从 system-hub 进入地图并看到 live 元数据
  动作: 浏览器打开 `/system`，点击“地图”，等待真实 `cecelia` map 请求完成。
  预期观察: URL 为 `/map`，标题、manifest、freshness、价值流与能力统计可见且等于同次 API。
  等待预算: 10s
  留证: `${SPRINT_DIR}/screenshots/staging-cecelia.png` + API 摘要
  Test: manual:bash -c '(cd apps/dashboard && npx vitest run --no-cache ./src/pages/map/MapPage.test.tsx -t '\''只从动态 feature manifest|Level 1 展示冻结清单'\'')'

- [ ] [BEHAVIOR] [L1] B-02: 双 scope 切换显示各自 live 投影且无残留
  动作: 依次选择 `cecelia` 和 `zenithjoy-workspace`，每次触发加载。
  预期观察: 当前 scope 的价值流/能力统计逐项等于该 scope 同次 API，较早响应不能覆盖较新 scope。
  等待预算: 10s
  留证: 两张 scope 截图 + 两次 API summary
  Test: manual:bash -c '(cd apps/dashboard && npx vitest run --no-cache ./src/pages/map/MapPage.test.tsx -t '\''第二个 scope'\'')'

- [ ] [BEHAVIOR] [L1] B-03: 三层展开、搜索、证明覆盖由投影驱动
  动作: 展开价值流与能力，搜索 live 节点名称，再搜索不存在字符串。
  预期观察: 特性与证明数量来自节点/关系；命中节点可见，无匹配出现空状态。
  等待预算: 3s
  留证: Vitest 输出与 Final E2E 页面截图
  Test: manual:bash -c '(cd apps/dashboard && npx vitest run --no-cache ./src/pages/map/MapPage.test.tsx -t '\''从 Capability 下钻到 Feature/Assertion'\'')'

- [ ] [BEHAVIOR] [L1] B-04: 横切件和交接面板呈现真实关系
  动作: 打开含横切件/交接边的 capability 详情。
  预期观察: 页面能识别 `serves`、`owned_by`、`hands_off_to`，关系端点与响应一致。
  等待预算: 3s
  留证: Vitest 输出中对应关系断言
  Test: manual:bash -c '(cd apps/dashboard && npx vitest run --no-cache ./src/pages/map/MapPage.test.tsx -t '\''Level 1 展示冻结清单|从 Capability 下钻到 Feature/Assertion'\'')'

- [ ] [BEHAVIOR] [L1] B-05: 非 fresh、错误、空数据均 fail closed
  动作: 让组件依次收到非 fresh、非 2xx 与空 nodes/edges 响应并点击重试。
  预期观察: 持续警告、错误态或空态清晰可见，错误时不出现成功投影。
  等待预算: 10s
  留证: frozen sprint test 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/08232142-kernel-2f9de07c/tests/map-page.contract.test.ts -t '\''系统总图页面文件存在并包含 live map 用户路径'\'''

- [ ] [BEHAVIOR] [L1] B-06: 公共页面不暴露 map rebuild 特权操作
  动作: 以 Dashboard 本地管理员身份打开地图页。
  预期观察: 页面只读探索，找不到“重建”按钮。
  等待预算: 3s
  留证: MapPage auth test 输出
  Test: manual:bash -c '(cd apps/dashboard && npx vitest run --no-cache ./src/pages/map/MapPage.auth.test.tsx)'

- [ ] [BEHAVIOR] [L3] B-07: 真实 Dashboard 与 Brain 完成全程验收 [接缝×2]
  动作: 启动 localhost:5174，浏览器从 system-hub 进入地图，连续核对两个真实 scope 并搜索节点。
  预期观察: 页面统计、freshness 与同次真实 API 一致，搜索命中/空态可见，两次执行结果一致。
  等待预算: 120s
  留证: `${SPRINT_DIR}/screenshots/staging-cecelia.png`、`${SPRINT_DIR}/screenshots/staging-zenithjoy.png` 和 Playwright 输出
  Test: manual:bash -c 'awk '\''/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{b=0;next} b{print}'\'' sprints/08232142-kernel-2f9de07c/contract-draft.md > /tmp/map-final-e2e.sh && bash /tmp/map-final-e2e.sh'

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E:screenshot] evaluator 在真实 Dashboard + Brain 上完成双 scope 验收。
  Screenshots:
    - `staging-cecelia.png`：cecelia live manifest、freshness 和统计可见。
    - `staging-zenithjoy.png`：zenithjoy-workspace 统计可见且无 cecelia 残留。
  路径: `${SPRINT_DIR}/screenshots/<step>.png`

## Invariant 映射

- INV-1 分支归属：本轮只提交到 Brain 签发的 proposer branch，不触碰 main。
- INV-2 全量继承：area invariant 89 条继续生效；本 sprint 只改 Dashboard 呈现层，禁止改变 Brain 约束与 map 数据层。
