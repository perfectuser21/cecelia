---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: HarnessDetailPage 文档 tab

**范围**: 在 apps/dashboard/src/pages/harness/HarnessDetailPage.tsx 新增"文档"tab（与"实时日志"并列），点击后 fetch GET /api/brain/harness/sprint-docs?sprint_dir=...，使用 react-markdown（若未安装则新增依赖）渲染 docs.sprint_prd（含 docs.prep_prd），data-testid="docs-tab-content"；tab 触发器 data-testid="docs-tab"
**大小**: M（~150 行净增，1-2 文件）
**依赖**: Workstream 3

## ARTIFACT 条目

- [ ] [ARTIFACT] HarnessDetailPage.tsx 含 data-testid="docs-tab" 触发器
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessDetailPage.tsx','utf8');if(!c.includes('docs-tab'))process.exit(1)"

- [ ] [ARTIFACT] HarnessDetailPage.tsx 含 data-testid="docs-tab-content" 渲染容器
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessDetailPage.tsx','utf8');if(!c.includes('docs-tab-content'))process.exit(1)"

- [ ] [ARTIFACT] HarnessDetailPage.tsx 含 sprint-docs API 调用路径
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessDetailPage.tsx','utf8');if(!c.includes('sprint-docs'))process.exit(1)"

- [ ] [ARTIFACT] HarnessDetailPage.tsx 含 markdown 渲染（react-markdown 或 dangerouslySetInnerHTML）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessDetailPage.tsx','utf8');if(!c.includes('react-markdown')&&!c.includes('dangerouslySetInnerHTML'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] HarnessDetailPage.tsx 同时含 docs-tab 和 docs-tab-content（WS 实现前两者都缺 → FAIL）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/harness/HarnessDetailPage.tsx\",\"utf8\");if(!c.includes(\"docs-tab\")){console.error(\"FAIL: docs-tab 缺失\");process.exit(1)}if(!c.includes(\"docs-tab-content\")){console.error(\"FAIL: docs-tab-content 缺失\");process.exit(1)}if(!c.includes(\"sprint-docs\")){console.error(\"FAIL: sprint-docs API 调用缺失\");process.exit(1)}console.log(\"OK\")"'
  期望: OK；三个关键字符串同时存在

- [ ] [BEHAVIOR] GET /api/brain/harness/sprint-docs 对已知 sprint_dir 返回 sprint_prd 字符串内容（依赖 WS3 已实现）
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/sprint-docs?sprint_dir=sprints/cecelia-sprint-visibility-0528") || { echo "FAIL: API 不可达"; exit 1; }; TYPE=$(echo "$RESP" | jq -r ".docs.sprint_prd | type"); [ "$TYPE" = "string" ] || { echo "FAIL: sprint_prd 类型=$TYPE 应为 string"; exit 1; }; echo OK sprint_prd=$TYPE'
  期望: OK sprint_prd=string

- [ ] [BEHAVIOR] HarnessDetailPage.tsx 含 Tab 切换 state 逻辑（activeTab/selectedTab/tabState 等 state 变量）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/harness/HarnessDetailPage.tsx\",\"utf8\");const hasState=/useState.*tab|activeTab|selectedTab|tabState|currentTab/i.test(c);if(!hasState){console.error(\"FAIL: 缺少 tab state 管理\");process.exit(1)}console.log(\"OK\")"'
  期望: OK；含 tab 切换 state 管理代码

- [ ] [BEHAVIOR] react-markdown 依赖存在（package.json 或 node_modules）
  Test: manual:bash -c 'node -e "require.resolve(\"react-markdown\")" 2>/dev/null && echo OK || { node -e "const p=require(\"fs\").readFileSync(\"apps/dashboard/package.json\",\"utf8\");JSON.parse(p).dependencies[\"react-markdown\"]||process.exit(1)" && echo OK in-pkg || { echo "WARN: react-markdown 未找到，可能需要 npm install"; }; }'
  期望: OK（安装或在 package.json 中声明）

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 用户点击"文档"tab，docs-tab-content 可见，markdown 已渲染（Playwright 真实浏览器验证）
  Screenshots:
    - ws4-01-initial.png   期望：HarnessDetailPage 加载完成，实时日志 tab 可见，文档 tab 触发器可见
    - ws4-02-docs-tab.png  期望：点击文档 tab 后，docs-tab-content 渲染区可见
    - ws4-03-content.png   期望：markdown 内容已渲染（非空文本，可见标题或段落）
  期望：所有截图与描述一致；Playwright toBeVisible 断言通过
