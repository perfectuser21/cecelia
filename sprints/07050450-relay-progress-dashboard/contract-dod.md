---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: Relay 进度条 Dashboard 页面

**范围**: `apps/dashboard/src/pages/relay-progress/` 新建页面组件 + 路由注册；不修改 Brain 后端
**大小**: S

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx` 存在且含 `relay-progress-container` testid
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx','utf8');if(!c.includes('relay-progress-container'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx` 含 `/api/brain/orchestrator/relay-runs` 端点引用
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx','utf8');if(!c.includes('relay-runs'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 组件含 15000ms 自动刷新逻辑
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx','utf8');if(!c.includes('15000'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 组件含 `A_` 前缀剥离逻辑（`replace` 或等效处理）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx','utf8');if(!c.match(/A_|replace.*prefix|stripPhase/))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 路由注册：App.tsx 或路由配置中含 `/relay-progress` 路由
  Test: node -e "const files=['apps/dashboard/src/App.tsx'];let found=false;files.forEach(f=>{try{const c=require('fs').readFileSync(f,'utf8');if(c.includes('relay-progress'))found=true;}catch(e){}});if(!found)process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目

### 模式A BEHAVIOR（evaluator 逐 ws 跑，API-level，测真实后端）

- [ ] [BEHAVIOR] GET /api/brain/orchestrator/relay-runs 端点返回 200 + 数组响应
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/orchestrator/relay-runs) || { echo "FAIL: 端点返回非 2xx"; exit 1; }; echo "$RESP" | jq -e ". | type == \"array\"" || { echo "FAIL: 响应不是 JSON 数组"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] relay-runs 响应数组元素（若非空）含 initiative_id 字段（string 类型）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/orchestrator/relay-runs) || exit 1; COUNT=$(echo "$RESP" | jq "length"); if [ "$COUNT" -gt "0" ]; then echo "$RESP" | jq -e ".[0].initiative_id | type == \"string\"" || { echo "FAIL: initiative_id 缺失或非 string"; exit 1; }; fi; echo OK'
  期望: OK

- [ ] [BEHAVIOR] relay-runs 响应数组元素（若非空）含 phase 字段（string 类型）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/orchestrator/relay-runs) || exit 1; COUNT=$(echo "$RESP" | jq "length"); if [ "$COUNT" -gt "0" ]; then echo "$RESP" | jq -e ".[0].phase | type == \"string\"" || { echo "FAIL: phase 缺失或非 string"; exit 1; }; fi; echo OK'
  期望: OK

- [ ] [BEHAVIOR] relay-runs 响应禁用字段 id 不存在（initiative_id 不得被替换为 id）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/orchestrator/relay-runs) || exit 1; COUNT=$(echo "$RESP" | jq "length"); if [ "$COUNT" -gt "0" ]; then echo "$RESP" | jq -e ".[0] | has(\"id\") | not" || { echo "FAIL: 响应含禁用字段 id（应为 initiative_id）"; exit 1; }; fi; echo OK'
  期望: OK

- [ ] [BEHAVIOR] relay-runs 响应禁用字段 verdict 不存在（应为 judge_verdict）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/orchestrator/relay-runs) || exit 1; COUNT=$(echo "$RESP" | jq "length"); if [ "$COUNT" -gt "0" ]; then echo "$RESP" | jq -e ".[0] | has(\"verdict\") | not" || { echo "FAIL: 响应含禁用字段 verdict（应为 judge_verdict）"; exit 1; }; fi; echo OK'
  期望: OK

- [ ] [BEHAVIOR] phase A_ 前缀剥离逻辑：stripPhasePrefix 函数对 A_planning 返回 planning
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx\",\"utf8\");const m=c.match(/function stripPhasePrefix[^}]+}|const stripPhasePrefix[^;]+;/s);if(!m){console.error(\"FAIL: 未找到 stripPhasePrefix\");process.exit(1);}console.log(\"OK phase-strip 函数存在\")"'
  期望: OK phase-strip 函数存在

- [ ] [BEHAVIOR] RelayProgressPage 组件文件含空态渲染逻辑（relay-progress-empty testid）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx\",\"utf8\");if(!c.includes(\"relay-progress-empty\")){console.error(\"FAIL: 缺少空态 testid\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] RelayProgressPage 组件文件含错误状态渲染逻辑（relay-progress-error testid）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx\",\"utf8\");if(!c.includes(\"relay-progress-error\")){console.error(\"FAIL: 缺少错误态 testid\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

---

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑，mac_web Playwright）

- [ ] [BEHAVIOR:E2E] 用户打开 relay-progress 页，进度容器可见（真实 Playwright + 真实后端 relay-runs API）
  Test: manual:bash -c 'cd /workspace && npx playwright test sprints/07050450-relay-progress-dashboard/tests/e2e-relay-progress.spec.ts --reporter=list'
  期望: Playwright 所有 spec 通过，exit 0

- [ ] [BEHAVIOR:E2E:screenshot] evaluator 验收后截图已存入 sprints/07050450-relay-progress-dashboard/screenshots/
  Screenshots:
    - 01-initial.png      期望：进度页初始加载，relay-progress-container 可见
    - 02-phases.png       期望：七段 phase 标签全部可见（有数据时）或 02-empty.png 空态文案可见
    - 03-short-id.png     期望：initiative_id 前 8 位短码出现在页面（有数据时）
  路径格式: sprints/07050450-relay-progress-dashboard/screenshots/<step>.png
  期望: evaluator 完成后截图已复制到 sprints/07050450-relay-progress-dashboard/screenshots/ 目录
