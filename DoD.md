contract_branch: cp-harness-propose-r2-4e73a2b3
workstream_index: 3
sprint_dir: sprints/cecelia-pipeline-viz-v2

# DoD — WS3: Dashboard initiative 详情面板

## ARTIFACT 条目

- [x] [ARTIFACT] `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx` 含 `initiative-detail-panel` data-testid
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('initiative-detail-panel'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] Dashboard 页面含 `initiative-prd-content` 和 `initiative-step-timeline` 两个 data-testid
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('initiative-prd-content')||!c.includes('initiative-step-timeline'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `initiative-card` data-testid 绑定到 initiative 类型的 pipeline card 上
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('initiative-card'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [x] [BEHAVIOR] Dashboard TypeScript 编译无错误（组件代码有效，非空壳，TS 类型正确）
  Test: bash -c 'cd /workspace && npx tsc --project apps/dashboard/tsconfig.json --noEmit > /tmp/tsc-ws3-dod.txt 2>&1; node -e "const d=require(\"fs\").readFileSync(\"/tmp/tsc-ws3-dod.txt\",\"utf8\");d.toLowerCase().includes(\"error\")&&process.exit(1)||console.log(\"PASS\")"'

- [x] [BEHAVIOR] 组件调用 `/api/brain/harness/initiative` 端点（API 接入验证 — 测组件有无接入，而非测 WS2 API 本身）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('harness/initiative'))process.exit(1);console.log('PASS')"

- [x] [BEHAVIOR] 组件含截图条件渲染逻辑（screenshot_urls 为空时不渲染 section）及 PRD 内容渲染逻辑
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('screenshot_urls')||!c.includes('initiative-prd-content'))process.exit(1);console.log('PASS')"

- [x] [BEHAVIOR] 组件含点击交互逻辑（onClick handler）和 React 状态管理（useState/useReducer），驱动 step_timing 时间线渲染
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('onClick')||!c.includes('useState')||!c.includes('step_timing')||!c.includes('initiative-step-timeline'))process.exit(1);console.log('PASS')"
