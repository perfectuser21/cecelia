---
skeleton: false
journey_type: user_facing
target_environment: mac_web
---
# Contract DoD — Sprint: Dashboard 首页 Harness 工厂线贯通状态标识

**范围**: 在 Cecelia Dashboard 首页常驻可见区新增逐字固定文字 "Cecelia Harness 工厂线已贯通"（`data-testid="harness-pipeline-status"`），并端到端验证 staging:5223 → promote → live:5211 工厂线真贯通。不改流水线脚本、不新增 API/DB。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增首页状态标识组件，含逐字固定文字 + 稳定 testid
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/components/HarnessPipelineStatus.tsx','utf8');if(!c.includes('Cecelia Harness 工厂线已贯通')||!c.includes('harness-pipeline-status'))process.exit(1)"

- [ ] [ARTIFACT] App 壳层挂载该组件（保证首页可见）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/App.tsx','utf8');if(!c.includes('HarnessPipelineStatus'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

> 本 sprint 无 HTTP/DB 响应，oracle = 构建产物含文字（逻辑）+ 浏览器可见（逻辑）+ 生产 promote 真生效（接缝）。

### 逻辑断言（环境无关，CI/本机绿即真）

- [ ] [BEHAVIOR] 本机构建产物（dist bundle）含逐字固定文字 —— 空实现/未落地必 FAIL
  Test: manual:bash -c 'cd apps/dashboard && (npm ci --prefer-offline >/dev/null 2>&1 || npm install >/dev/null 2>&1) && npm run build >/dev/null 2>&1 && grep -rq "Cecelia Harness 工厂线已贯通" dist/assets/ || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 组件红→绿单测通过（组件渲染含逐字文字 + testid + App 挂载）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/tests/harness-pipeline-status.test.ts --reporter=dot 2>&1 | tail -5 | grep -qE "passed|✓" || { echo FAIL; exit 1; }; echo OK'
  期望: OK

### 接缝断言（环境相关，**CI 绿 ≠ done，必须真目标验**；evaluator final-e2e 在真 harness host 跑）

- [ ] [BEHAVIOR] (SEAM) staging dashboard（:5223）真部署、HTTP 200 可预览
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:5223/"); [ "$CODE" = "200" ] || { echo "FAIL staging:5223=$CODE"; exit 1; }; echo OK'
  期望: OK（未真验前标 logic-done-pending）

- [ ] [BEHAVIOR] (SEAM) promote 后 live dashboard（:5211）首页 HTTP 200
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:5211/"); [ "$CODE" = "200" ] || { echo "FAIL live:5211=$CODE"; exit 1; }; echo OK'
  期望: OK（未真验前标 logic-done-pending）

- [ ] [BEHAVIOR] (SEAM) live:5211 生产实际 serve 的 JS bundle 真含逐字固定文字（promote 真把新代码推上生产）
  Test: manual:bash -c 'IDX=$(curl -sf --max-time 10 "http://localhost:5211/") || { echo "FAIL live unreachable"; exit 1; }; echo "$IDX" | grep -q "/assets/[A-Za-z0-9._-]\+\.js" || { echo "FAIL no bundle ref"; exit 1; }; ASSET=$(printf "%s" "$IDX" | grep -oE "/assets/[A-Za-z0-9._-]+\.js" | head -1); BUNDLE=$(curl -sf --max-time 10 "http://localhost:5211${ASSET}") || { echo "FAIL bundle unreachable"; exit 1; }; echo "$BUNDLE" | grep -q "Cecelia Harness 工厂线已贯通" || { echo "FAIL live bundle 无文字 — promote 未生效"; exit 1; }; echo OK'
  期望: OK（未真验前标 logic-done-pending）
  gate-allow: weak-oracle/curl-no-jq 响应是静态 JS bundle（非 JSON），grep -q 逐字固定文字即内容值断言，jq -e 不适用；此为单行 bash -c 内的跨语句 capture-then-assert（IDX/BUNDLE 捕获后同行 grep -q 断言），gate 仅跨物理行识别故此处显式豁免；其余 curl 均为 -w %{http_code} 状态码 oracle

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑 — Playwright 本机渲染）

- [ ] [BEHAVIOR:E2E] 主理人首页可见固定文字，暗/亮主题均可见，截图可视化验证
  Test: manual:bash -c 'cd /workspace && node sprints/tests/e2e-harness-status.cjs'
  Screenshots:
    - 01-initial.png   期望：首页默认主题加载，固定文字 "Cecelia Harness 工厂线已贯通" 可见
    - 02-action.png    期望：暗色主题下固定文字仍可见
    - 03-result.png    期望：亮色主题下固定文字仍可见
  期望：脚本 exit 0；所有截图与期望描述一致，Claude Read 图自验通过

- [ ] [BEHAVIOR:E2E:screenshot] evaluator 验收后截图已存入 sprints/screenshots/
  路径格式：sprints/screenshots/<step>.png
  期望：evaluator 完成后截图已复制到 sprints/screenshots/ 目录
