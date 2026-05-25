---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: Dashboard initiative 详情面板

**范围**: `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx`（或新建 `HarnessInitiativeDetailPanel.tsx`）— 点击 initiative card → 侧栏/抽屉展示 PRD全文/合约摘要/步骤时间线/截图 section
**大小**: M（120-160 行）
**依赖**: Workstream 2 完成后（面板调用 /detail API）

---

## Risks

### R3a: data-testid 属性名拼写与 Playwright 选择器不一致
**影响**: E2E 脚本用 `[data-testid="initiative-detail-panel"]` 选择器，若组件实际写成 `data-testid="initiativeDetailPanel"` 或拼写不同，Playwright toBeVisible 超时 → Mode B FAIL。
**缓解**: ARTIFACT 条目精确 grep data-testid 字面值；generator 必须字面使用合同规定的 testid（`initiative-detail-panel`/`initiative-prd-content`/`initiative-step-timeline`/`initiative-card`），不得驼峰化。

### R3b: TypeScript 编译错误导致整个 Dashboard 不可用
**影响**: WS3 引入的组件有 TS 类型错误时，vite dev server 编译失败，localhost:5174 不可访问 → Mode B final-e2e 全失败（不是 WS3 代码问题，是整个 E2E 环境崩溃）。
**缓解**: BEHAVIOR 1 的 `npx tsc --noEmit` 在 evaluator 逐 ws 阶段提前发现编译错误，并在 Mode B 前阻断；generator 须确保 WS3 组件 TS 类型正确。

---

## ARTIFACT 条目

- [x] [ARTIFACT] `apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx` 含 `initiative-detail-panel` data-testid
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('initiative-detail-panel'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] Dashboard 页面含 `initiative-prd-content` 和 `initiative-step-timeline` 两个 data-testid
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('initiative-prd-content')||!c.includes('initiative-step-timeline'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `initiative-card` data-testid 绑定到 initiative 类型的 pipeline card 上
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!c.includes('initiative-card'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（模式A：Dashboard 组件自身验证，evaluator 逐 ws 跑）

> **重要**: 以下 4 条 BEHAVIOR 验证 Dashboard **组件本身**，而非 WS2 API 连通性（WS2 已有专属 BEHAVIOR 覆盖 /detail 端点）。若 Generator 未写组件，BEHAVIOR 1（TypeScript 编译）即 FAIL；若写了空壳，BEHAVIOR 2-4（组件实现特征）FAIL。

- [x] [BEHAVIOR] Dashboard TypeScript 编译无错误（组件代码有效，非空壳，TS 类型正确）
  Test: manual:bash -c 'cd apps/dashboard && npx tsc --noEmit 2>&1 | tee /tmp/ws3-tsc.log; ERRS=$(grep -c "error TS" /tmp/ws3-tsc.log 2>/dev/null || echo 0); [ "${ERRS}" = "0" ] && echo OK || { echo "FAIL: ${ERRS} TypeScript 编译错误"; head -20 /tmp/ws3-tsc.log; exit 1; }'
  期望: OK

- [x] [BEHAVIOR] 组件调用 `/api/brain/harness/initiative` 端点（API 接入验证 — 测组件有无接入，而非测 WS2 API 本身）
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx'"'"','"'"'utf8'"'"'); if(!/harness\/initiative/.test(s)){console.error('"'"'FAIL: 组件未引用 /harness/initiative 路径，未接入 /detail 端点'"'"');process.exit(1)} if(!/initiative-detail-panel/.test(s)){console.error('"'"'FAIL: 缺 initiative-detail-panel JSX 结构'"'"');process.exit(1)} console.log('"'"'OK'"'"')"'
  期望: OK

- [x] [BEHAVIOR] 组件含截图条件渲染逻辑（screenshot_urls 为空时不渲染 section）及 PRD 内容渲染逻辑
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx'"'"','"'"'utf8'"'"'); if(!/screenshot_urls/.test(s)){console.error('"'"'FAIL: 缺 screenshot_urls 条件渲染'"'"');process.exit(1)} if(!/initiative-prd-content/.test(s)){console.error('"'"'FAIL: 缺 initiative-prd-content 渲染区块'"'"');process.exit(1)} console.log('"'"'OK'"'"')"'
  期望: OK

- [x] [BEHAVIOR] 组件含点击交互逻辑（onClick handler）和 React 状态管理（useState/useReducer），驱动 step_timing 时间线渲染
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx'"'"','"'"'utf8'"'"'); const hasClick=/onClick/.test(s); const hasState=/useState|useReducer/.test(s); const hasTimeline=/step_timing/.test(s)&&/initiative-step-timeline/.test(s); if(!hasClick||!hasState||!hasTimeline){console.error('"'"'FAIL: 缺 onClick='"'"'+hasClick+'"'"' useState='"'"'+hasState+'"'"' step_timing='"'"'+hasTimeline);process.exit(1)} console.log('"'"'OK'"'"')"'
  期望: OK

---

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [x] [BEHAVIOR:E2E] 用户完整走完 Golden Path：打开 /pipeline 页 → 点击 initiative card → 详情面板展示 PRD 全文 + 步骤时间线
  Screenshots:
    - 01-pipeline-list.png    期望：/pipeline 页正常加载，initiative card 列表可见，无 JS 错误
    - 02-card-click.png       期望：点击 card 后，侧栏/抽屉开始出现（过渡动画中）
    - 03-detail-panel.png     期望：`[data-testid="initiative-detail-panel"]` 可见，面板已完全展开
    - 04-prd-content.png      期望：`[data-testid="initiative-prd-content"]` 区块可见，含 "# Sprint PRD" 字样（Markdown 渲染）
    - 05-timeline.png         期望：`[data-testid="initiative-step-timeline"]` 可见，至少 1 条 step-timeline-item 显示
  期望：所有截图与期望描述一致，Claude Read 图自验通过；Playwright exit 0
