contract_branch: cp-harness-propose-r1-3f893d17-a0
sprint_dir: sprints/06171618-harness-pipeline-cockpit

---
skeleton: false
journey_type: user_facing
target_environment: mac_web
---
# Contract DoD — Sprint: Harness Pipeline Cockpit · Phase 1（TaskPrdPage 显示完整 PrepPRD）

**范围**: 纯前端渲染改动——`apps/dashboard/src/pages/tasks/TaskPrdPage.tsx` 的 `pickPrdContent` 优先读 `payload.prep_prd_body`，并用 Markdown 渲染替换 `<pre>`；Task payload 类型加 `prep_prd_body?: string`；新增 react-markdown + remark-gfm 依赖。不改后端、不新增端点。
**大小**: S

> 验证策略：本 Sprint 无新增 HTTP 端点（复用既有 `GET /api/brain/tasks/:id`），oracle 由组件层 vitest 断言（模式 A，BEHAVIOR）+ Playwright DOM 断言（模式 B，BEHAVIOR:E2E）承载。每条 BEHAVIOR 的 manual:bash 用 vitest `-t` 过滤精确跑一个用例，exit code 即 oracle——对应代码未实现则真实 FAIL（截图反例 #2/#5/#6/#10 已规避：无 mkdir/touch/exit 0 兜底/|| true）。

## ARTIFACT 条目

- [ ] [ARTIFACT] package.json 新增 Markdown 渲染依赖 react-markdown + remark-gfm
  Test: manual:bash -c 'node -e "const p=require(\"./apps/dashboard/package.json\");const d={...p.dependencies,...p.devDependencies};if(!d[\"react-markdown\"]||!d[\"remark-gfm\"])process.exit(1)" || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [ ] [ARTIFACT] Task payload 类型新增 prep_prd_body?: string
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/tasks/TaskPrdPage.tsx\",\"utf8\");if(!/prep_prd_body\?:\s*string/.test(c))process.exit(1)" || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [ ] [ARTIFACT] pickPrdContent 字面读取 payload.prep_prd_body（优先级最前，不使用禁用同义词）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/tasks/TaskPrdPage.tsx\",\"utf8\");const fn=c.slice(c.indexOf(\"function pickPrdContent\"));if(!/payload\?\.prep_prd_body/.test(fn))process.exit(1);if(/prepPrdBody|prep_prd_body_|\.prd_body/.test(fn))process.exit(2)" || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [ ] [ARTIFACT] PRD 主体改用 react-markdown 渲染（移除包裹原始 Markdown 的 <pre>）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/tasks/TaskPrdPage.tsx\",\"utf8\");if(!/react-markdown/.test(c))process.exit(1);if(!/data-testid=\"prd-content\"/.test(c))process.exit(2)" || { echo FAIL; exit 1; }; echo OK'
  期望: OK

## BEHAVIOR 条目（模式 A — 组件层 vitest，manual:bash exit code 即 oracle）

> 每条对应 Golden Path 一步的用户可观察输出。命令在 `apps/dashboard` 下用 vitest `-t` 精确跑单个用例；未实现则断言 FAIL。

- [ ] [BEHAVIOR] (Golden Path Step 1) 打开 PRD 页主体正常渲染，不报错不空白
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/tasks/TaskPrdPage.prepprd.test.tsx -t "页面加载渲染主体不报错" --reporter=dot'
  期望: exit 0

- [ ] [BEHAVIOR] (Golden Path Step 2) pickPrdContent 优先读 payload.prep_prd_body，旧字段（description/prd_summary）被忽略
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/tasks/TaskPrdPage.prepprd.test.tsx -t "prep_prd_body 优先于旧字段" --reporter=dot'
  期望: exit 0

- [ ] [BEHAVIOR] (Golden Path Step 3) Markdown 渲染为真实 DOM：`# 标题`→`<h1>`（文字非字面 #），主体不再是包裹原文的 `<pre>`
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/tasks/TaskPrdPage.prepprd.test.tsx -t "Markdown 渲染为真实 DOM 元素" --reporter=dot'
  期望: exit 0

- [ ] [BEHAVIOR] (边界 2) GFM 表格→`<table>`、列表→`<ul><li>` 正确渲染
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/tasks/TaskPrdPage.prepprd.test.tsx -t "表格与列表按 Markdown 渲染" --reporter=dot'
  期望: exit 0

- [ ] [BEHAVIOR] (边界 1) prep_prd_body 为空 → 退回旧字段，页面仍显示已有内容
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/tasks/TaskPrdPage.prepprd.test.tsx -t "prep_prd_body 为空时退回旧字段" --reporter=dot'
  期望: exit 0

- [ ] [BEHAVIOR] (回归守卫) 404 / 网络错误态不回归
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/tasks/TaskPrdPage.prepprd.test.tsx -t "404 与网络错误态不回归" --reporter=dot'
  期望: exit 0

## BEHAVIOR:E2E 条目（user_facing 专属，模式 B final-e2e 跑 — mac_web Playwright）

- [ ] [BEHAVIOR:E2E] 用户从 PR body「📋 PRD」打开 `/tasks/:id/prd`，完整 PrepPRD 全文以 Markdown 渲染（截图自验）
  Test: manual:bash -c 'cd apps/dashboard && npx playwright test ../../sprints/06171618-harness-pipeline-cockpit/e2e/task-prd.spec.ts --reporter=list'
  期望: exit 0（断言：PrepPRD 小节标题文字可见 + [data-testid=prd-content] 内含 h1/h2/ul/table 且无包裹原文的 pre + 旧 description 不出现）
  Screenshots:
    - 01-initial.png   期望：PRD 页加载，task 标题「E2E PrepPRD Task」与 PRD 区块可见
    - 02-action.png    期望：完整 PrepPRD 全文小节标题（Golden Path / 前置 / 验收）以 Markdown 呈现
    - 03-result.png    期望：表格/列表为真实 DOM 元素，旧 description 文本不出现
  路径格式：${SPRINT_DIR}/screenshots/<step>.png
  期望：evaluator 完成后截图已复制到 ${SPRINT_DIR}/screenshots/，Claude Read 图自验通过

> evaluator 完成 E2E 后执行：
> ```bash
> mkdir -p "${SPRINT_DIR}/screenshots/"
> cp apps/dashboard/screenshots/*.png "${SPRINT_DIR}/screenshots/" 2>/dev/null || true
> ```
