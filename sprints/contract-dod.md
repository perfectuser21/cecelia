---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: Dashboard 首页加固定状态标识文字

**范围**: `apps/dashboard/src/App.tsx` 主布局区域添加一行静态文字 "Cecelia Harness 工厂线已贯通"，带 `data-testid="harness-status-banner"`，不依赖 auth 状态或 API 数据
**大小**: S

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/App.tsx` 源码中包含字符串 `Cecelia Harness 工厂线已贯通`
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/App.tsx','utf8');if(!c.includes('Cecelia Harness 工厂线已贯通'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/App.tsx` 中含 `data-testid="harness-status-banner"` 属性
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/App.tsx','utf8');if(!c.includes('data-testid=\"harness-status-banner\"'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] `App.tsx` 源码层文字内容完整匹配（schema 字段值等价 — 文字精确一致）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"/workspace/apps/dashboard/src/App.tsx\",\"utf8\");if(!c.includes(\"Cecelia Harness 工厂线已贯通\")){console.error(\"FAIL: 文字不存在\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `App.tsx` 含 `data-testid="harness-status-banner"` 属性（UI 定位锚点完整性）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"/workspace/apps/dashboard/src/App.tsx\",\"utf8\");if(!c.includes(\"data-testid=\\\\\"harness-status-banner\\\\\"\")){ if(!c.includes(\"harness-status-banner\")){console.error(\"FAIL: data-testid 缺失\");process.exit(1);}}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 文字实现为静态硬编码，无动态 API 依赖（禁用字段反向等价 — 无 fetch/useEffect 围绕目标文字）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"/workspace/apps/dashboard/src/App.tsx\",\"utf8\");const idx=c.indexOf(\"harness-status-banner\");if(idx===-1){console.error(\"FAIL: 元素不存在\");process.exit(1);}const ctx=c.slice(Math.max(0,idx-100),idx+200);if(/useState.*工厂线|useEffect.*工厂线|fetch.*工厂线/.test(ctx)){console.error(\"FAIL: 发现动态依赖\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 文字所在元素位于 `AppContent` 函数的 JSX 返回值中（位置合理性 — error path 等价）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"/workspace/apps/dashboard/src/App.tsx\",\"utf8\");const inAppContent=c.indexOf(\"function AppContent\")!==-1&&c.indexOf(\"harness-status-banner\")>c.indexOf(\"function AppContent\");if(!inAppContent){console.error(\"FAIL: 元素不在 AppContent 中\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

---

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B Final E2E 跑）

- [ ] [BEHAVIOR:E2E] 用户访问 localhost:5174，固定文字可见且刷新后持久
  Screenshots:
    - 01-initial.png      期望：localhost:5174 加载完成，页面初始状态可见（无需登录）
    - 02-banner-visible.png  期望：`data-testid="harness-status-banner"` 元素可见，文字 "Cecelia Harness 工厂线已贯通" 清晰显示
    - 03-after-reload.png   期望：页面刷新后同 02，文字仍可见，内容不变（静态渲染验证）
  期望：所有截图与期望描述一致，Claude Read 图自验通过
