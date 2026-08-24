---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: 系统总图页上线（map 投影现算 + mind-elixir 三层脑图）

**范围**: 在既有 `apps/api/features/planning/pages/MapPage.tsx`（live 现算总图页，已绿）上 **additive** 叠加 mind-elixir 三层可折叠脑图 + 纯函数 view-model + `apps/dashboard/package.json` 依赖；不删改既有语义 DOM，不新增/改后端端点，不新建顶层目录。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] apps/dashboard/package.json 声明 mind-elixir 依赖（MIT）
  Test: node -e "const p=require('/workspace/apps/dashboard/package.json');const d={...(p.dependencies||{}),...(p.devDependencies||{})};if(!d['mind-elixir'])process.exit(1)"

- [ ] [ARTIFACT] view-model 纯函数落在 planning 内部并导出 buildMindmapTree
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/api/features/planning/pages/mapMindmap.ts','utf8');if(!/export\s+function\s+buildMindmapTree|export\s+const\s+buildMindmapTree/.test(c))process.exit(1)"

- [ ] [ARTIFACT] MapPage.tsx 挂载 mind-elixir 容器且引用 view-model（不删既有语义 DOM）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/api/features/planning/pages/MapPage.tsx','utf8');if(!c.includes('map-mindmap')||!c.includes('mapMindmap')||!c.includes('通用地图'))process.exit(1)"

## BEHAVIOR 条目（五行剧本，内嵌 manual:bash 单行命令）

- [ ] [BEHAVIOR] [L2] B-01: mind-elixir view-model 从 contains 边推导三层脑图
  动作: 运行本 sprint 冻结测试 sprints/08241956-kernel-9daed395/tests/map-mindmap.test.ts
  预期观察: buildMindmapTree(nodes,edges) 返回 2 个价值流根，能力挂在其价值流下，特性经折叠 backbone 挂在能力下（三层嵌套），测试全绿
  等待预算: 0s
  留证: vitest 输出末 5 行（含 Tests passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/08241956-kernel-9daed395/tests/map-mindmap.test.ts --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-02: 权威回归测试保持 4/4 全绿（mind-elixir additive 不回归）
  动作: 运行既有权威测试 apps/dashboard/src/pages/map/MapPage.test.tsx
  预期观察: 原有 4 条断言（唯一 /map 注册、Level1 全景、下钻 receipt、第二 scope 回退）全过，退出码 0
  等待预算: 0s
  留证: vitest 输出（Test Files 1 passed / Tests 4 passed）
  Test: manual:bash -c 'cd /workspace/apps/dashboard && npx vitest run src/pages/map/MapPage.test.tsx --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-03: /map 页渲染 mind-elixir 容器且非 fresh 出现可见提示（stale mock 单测）
  动作: 运行 apps/dashboard/src/pages/map/ 全部组件测试（含新增 mindmap 容器断言 + stale freshness 提示断言）
  预期观察: 渲染 MapPage 出现 data-testid=map-mindmap 容器；freshness.status!=fresh 时出现可见提示元素（role=status 或警示文案），测试全绿
  等待预算: 0s
  留证: vitest 输出（含 mindmap/stale 用例通过）
  Test: manual:bash -c 'cd /workspace/apps/dashboard && npx vitest run src/pages/map/ --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-04: cecelia scope 现算 summary == 2 价值流 / 11 能力（页面读数与 API 一致） [接缝×2]
  动作: 现算读取 GET /api/brain/map?scope=cecelia 的 summary
  预期观察: value_streams==2 且 capabilities==11（与页面 DOM 文案同值，E2E 交叉验证）
  等待预算: 10s
  留证: curl+jq 输出（summary JSON）
  Test: manual:bash -c 'S=$(curl -sf --max-time 10 "localhost:5221/api/brain/map?scope=cecelia"); echo "$S" | jq -e ".summary.value_streams==2 and .summary.capabilities==11" || { echo FAIL; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-05: error path — 缺 scope 参数返回 4xx（不静默兜底）
  动作: 请求 GET /api/brain/map（不带 scope）
  预期观察: HTTP 400（MAP_SCOPE_REQUIRED），非 200 假绿
  等待预算: 6s
  留证: curl 状态码输出
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 6 "localhost:5221/api/brain/map"); [ "$CODE" = "400" ] || { echo "FAIL: HTTP=$CODE"; exit 1; }; echo OK'

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑，mac_web）

- [ ] [BEHAVIOR:E2E] 用户完整走完 Golden Path（打开 /#/map → 语义全景+mind-elixir 脑图 → scope 切换重渲染 → freshness 徽标），截图可视化验证
  Screenshots:
    - 01-initial.png   期望：/#/map 加载，通用地图标题可见，2 条价值流 / 11 个 Capability 与 API summary 一致
    - 02-action.png    期望：mind-elixir 容器可见非空，freshness 徽标显示「新鲜」
    - 03-result.png    期望：scope 切到 zenithjoy-workspace 后数字变为该 scope summary（5/20），无旧 scope 残留
  期望：所有截图与期望描述一致，脚本 exit 0（详见 contract-draft.md ## E2E 验收）
