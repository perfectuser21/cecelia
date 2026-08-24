---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: 系统总图页上线（map 投影现算渲染）

**范围**: 把已存在的 `/map` 页面（`apps/api/features/planning/pages/MapPage.tsx`）升级为直连 `GET /api/brain/map` 现算渲染的三层可折叠 mind-elixir 脑图；mind-elixir(MIT) 入 `apps/dashboard/package.json`；`/map` 路由与既有 dashboard 测试 keep-green。仅消费 map API，不改后端投影算法，不新建顶层目录。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] mind-elixir(MIT) 已入 apps/dashboard/package.json dependencies
  Test: node -e "const p=require('./apps/dashboard/package.json');if(!p.dependencies||!p.dependencies['mind-elixir'])process.exit(1)"

- [ ] [ARTIFACT] MapPage 接入 mind-elixir 渲染脑图（源码引用 mind-elixir）
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/planning/pages/MapPage.tsx','utf8');if(!/mind-elixir/.test(c))process.exit(1)"

- [ ] [ARTIFACT] Playwright E2E spec 存在且打真实后端（不 page.route 拦截 /api/brain/map）
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('apps/dashboard/e2e/map.spec.ts','utf8');if(/page\.route\([^)]*api\/brain\/map/.test(c))process.exit(1);if(!/\/map/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令 — journey_type=user_facing；模式A=API-level/组件；模式B=Playwright 见 E2E 段）

- [ ] [BEHAVIOR] [L2] B-01: cecelia scope 现算返回 2 价值流、11 能力
  动作: 对 Brain 现算端点发起 GET /api/brain/map?scope=cecelia（页面 live-fetch 的同源）
  预期观察: summary.value_streams=2 且 summary.capabilities=11
  等待预算: 0s
  留证: curl+jq 命令 exit code 与 summary 输出
  Test: manual:bash -c 'curl -sf "localhost:5221/api/brain/map?scope=cecelia" | jq -e ".summary.value_streams==2 and .summary.capabilities==11"'

- [ ] [BEHAVIOR] [L2] B-02: nodes 计数/名称与 summary 一致（防页面造数/丢数）
  动作: 拉取 cecelia map，按 nodes[].type 统计 value_stream 与 capability
  预期观察: value_stream 节点=2 且名称集合={工厂,管家}，capability 节点=11
  等待预算: 0s
  留证: /tmp/m.json + jq 断言输出
  Test: manual:bash -c 'curl -sf "localhost:5221/api/brain/map?scope=cecelia" -o /tmp/m.json && jq -e "([.nodes[]|select(.type==\"value_stream\")]|length)==2 and ([.nodes[]|select(.type==\"capability\")]|length)==11 and (([.nodes[]|select(.type==\"value_stream\")|.name]|sort)==([\"工厂\",\"管家\"]|sort))" /tmp/m.json'

- [ ] [BEHAVIOR] [L2] B-03: freshness.status 可取且驱动徽标（页面须一致，禁静默判 fresh）
  动作: 读取 cecelia map 的 freshness.status（当前实测 unknown=非 fresh）
  预期观察: freshness.status 非空字符串；页面徽标/提示须与该值一致（E2E cross-check，见 BEHAVIOR:E2E）
  等待预算: 0s
  留证: freshness.status 取值输出
  Test: manual:bash -c 'FS=$(curl -sf "localhost:5221/api/brain/map?scope=cecelia" | jq -r ".freshness.status"); [ -n "$FS" ] && [ "$FS" != "null" ] && echo "OK freshness=$FS"'

- [ ] [BEHAVIOR] [L2] B-04: 空态/错误态不白屏 + scope 并发 last-wins（组件层，mock fetch 触发）
  动作: 跑 dashboard MapPage 组件测试（vitest, happy-dom），覆盖空 nodes/请求失败/并发切 scope
  预期观察: 错误态与空态渲染出可见文案（DOM 非空），并发切 scope 最终视图=最后一次选择
  等待预算: 0s
  留证: vitest 末 5 行输出（含 pass 汇总）
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/map/MapPage.test.tsx --reporter=basic 2>&1 | tail -8'

- [ ] [BEHAVIOR] [L2] B-05: mind-elixir(MIT) 入依赖 + /map 路由 keep-green（planning 注册唯一、system-hub 不注册）
  动作: 校验 apps/dashboard/package.json 含 mind-elixir，并跑 dashboard MapPage 路由回归测试
  预期观察: mind-elixir 存在于 dependencies；MapPage.test.tsx / MapPage.auth.test.tsx 全通过
  等待预算: 0s
  留证: node 校验 exit code + vitest 末 8 行
  Test: manual:bash -c 'node -e "const p=require(\"./apps/dashboard/package.json\");if(!p.dependencies[\"mind-elixir\"])process.exit(1)" && cd apps/dashboard && npx vitest run src/pages/map/MapPage.test.tsx src/pages/map/MapPage.auth.test.tsx --reporter=basic 2>&1 | tail -8'

- [ ] [BEHAVIOR] [L2] INV-1: [凭据隔离] 页面为只读消费，不注入任何身份凭据（不变量不可破坏）
  动作: 扫描 MapPage.tsx 源码，确认无 Authorization/Bearer/x-agent-id/*TOKEN 等凭据注入
  预期观察: 页面仅走 dashboard 现有 proxy 的匿名 GET/radius 查询，无凭据混用面，凭据隔离铁律天然满足
  等待预算: 0s
  留证: node 扫描 exit code
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/features/planning/pages/MapPage.tsx\",\"utf8\");if(/Authorization|Bearer|x-agent-id|process\.env\.[A-Z_]*TOKEN/.test(c))process.exit(1)"'

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑 — Playwright localhost:5174，禁 page.route 拦截 /api/brain/map）

- [ ] [BEHAVIOR:E2E] [L3] [接缝×2] 用户走完 Golden Path：打开 /map → 三层脑图 → 切 scope → 搜索 → freshness 提示
  动作: 浏览器打开 localhost:5174/map（真实 fetch /api/brain/map?scope=cecelia），展开价值流→能力→特性；切 scope 到 zenithjoy-workspace；搜索定位节点；观察 freshness 徽标
  预期观察: mind-elixir 脑图渲染根+2 价值流（工厂/管家）可折叠展开到能力/特性层；切 scope 后脑图重渲染且请求 URL 含 scope=zenithjoy-workspace；搜索命中≥1 节点；freshness 徽标/提示与 API freshness.status 一致（非 fresh 时出现可见过期提示 + reason_code，不白屏）
  等待预算: 60s
  留证: 截图存入 ${SPRINT_DIR}/screenshots/
  Screenshots:
    - 01-map-cecelia.png    期望：/map 打开，mind-elixir 脑图渲染出根与 2 价值流节点（工厂/管家）
    - 02-expand-capability.png  期望：展开某价值流后出现能力层节点（含测试证明数/覆盖条）
    - 03-scope-zenithjoy.png    期望：切到 zenithjoy-workspace 后脑图重新渲染对应投影
    - 04-freshness.png          期望：freshness 徽标/过期提示与 API freshness.status 一致（非 fresh 时可见过期提示）
  路径格式：${SPRINT_DIR}/screenshots/<step>.png
  验证脚本: 见 contract-draft.md `## E2E 验收` 段，由 evaluator mode B 执行 apps/dashboard/e2e/map.spec.ts（Playwright 真实浏览器打真实后端）
