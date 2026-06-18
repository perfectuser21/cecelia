---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: Harness Pipeline Cockpit · Phase 2（read-only 全生命周期视图）

**范围**: `apps/dashboard/src/pages/harness-pipeline/` — 把 file-based「文档」Tab（`SprintDocsSection`，渲染「文件不存在」）替换为 read-only 七项全生命周期视图，每项独立读 Brain DB/API，缺失走「未到该步」语义化占位。抽出纯逻辑模块 `lifecycle.ts` 承载分区定义与占位选择。**纯前端 read-only，无新增端点、无写操作。**
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 纯逻辑模块 lifecycle.ts 存在，导出七项分区 + 两类占位常量（NOT_REACHED/FETCH_FAILED）+ 选择函数
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/lifecycle.ts','utf8');if(!/LIFECYCLE_SECTIONS/.test(c)||!/selectSectionContent/.test(c)||!/未到该步/.test(c)||!/取数失败/.test(c))process.exit(1)"

- [ ] [ARTIFACT] HarnessPipelineDetailPage 文档区改读生命周期模块，不再渲染「文件不存在」
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(c.includes('文件不存在'))process.exit(1)"

- [ ] [ARTIFACT] generator DOM 测试存在并覆盖关键断言（全文/占位/无死字/降级）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/__tests__/PipelineLifecycle.test.tsx','utf8');for(const k of ['未到该步','文件不存在','prep_prd'])if(!c.includes(k))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual:bash，user_facing 前端 → vitest 渲染断言驱动）

> 本 Sprint 为纯前端 read-only 渲染改动，无新增 HTTP 端点，故 oracle 用 vitest 执行组件/纯逻辑断言（exit code 驱动，非 echo 假绿）。纯逻辑测试由 proposer 写在 sprints/.../tests/（node env，genuine red）；DOM 测试由 generator 写在 apps/dashboard（happy-dom）。模式 B（mac_web Playwright）见 contract-draft.md `## E2E 验收`。

- [ ] [BEHAVIOR] 七项分区按生命周期顺序定义（Golden Path Step 1）
  Test: manual:bash -c 'cd packages/brain && npx vitest run sprints/06181500-cockpit-phase2-lifecycle/tests/lifecycle-contract.test.ts -t "七项分区按生命周期顺序"'
  期望: exit 0

- [ ] [BEHAVIOR] 缺失项返回「未到该步」占位、有源项返回 markdown（Golden Path Step 3）
  Test: manual:bash -c 'cd packages/brain && npx vitest run sprints/06181500-cockpit-phase2-lifecycle/tests/lifecycle-contract.test.ts -t "缺失项返回未到该步占位"'
  期望: exit 0

- [ ] [BEHAVIOR] 取数失败 → 专属「取数失败」占位，与「未到该步」字面分流（纯逻辑层，Golden Path Step 5 / Risk a,b）
  Test: manual:bash -c 'cd packages/brain && npx vitest run sprints/06181500-cockpit-phase2-lifecycle/tests/lifecycle-contract.test.ts -t "取数失败与未到该步占位分流"'
  期望: exit 0

- [ ] [BEHAVIOR] DoD/Report 不从 contract 字符串切段冒充（纯逻辑层，Risk c — 解析脆弱性 mitigation）
  Test: manual:bash -c 'cd packages/brain && npx vitest run sprints/06181500-cockpit-phase2-lifecycle/tests/lifecycle-contract.test.ts -t "DoD 不从 contract 字符串切段冒充"'
  期望: exit 0

- [ ] [BEHAVIOR] 任何分区内容都不会是「文件不存在」（纯逻辑负向，Golden Path Step 4）
  Test: manual:bash -c 'cd packages/brain && npx vitest run sprints/06181500-cockpit-phase2-lifecycle/tests/lifecycle-contract.test.ts -t "占位文案绝不为文件不存在"'
  期望: exit 0

- [ ] [BEHAVIOR] PrepPRD 显示 DB 全文并 Markdown 渲染（DOM，Golden Path Step 2）
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/harness-pipeline/__tests__/PipelineLifecycle.test.tsx -t "PrepPRD 显示 DB 全文并 Markdown 渲染"'
  期望: exit 0

- [ ] [BEHAVIOR] 全页不出现「文件不存在」死字（DOM 负向 + 源码守卫，Golden Path Step 4）
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/harness-pipeline/__tests__/PipelineLifecycle.test.tsx -t "全页不出现文件不存在死字" && cd .. && ! grep -q "文件不存在" apps/dashboard/src/pages/harness-pipeline/lifecycle.ts'
  期望: exit 0

- [ ] [BEHAVIOR] 单项 Brain API 取数失败 → 降级占位整页不崩（DOM，Golden Path Step 5）
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/harness-pipeline/__tests__/PipelineLifecycle.test.tsx -t "单项取数失败降级占位不崩页"'
  期望: exit 0

- [ ] [BEHAVIOR] PrepPRD 渲染等于 DB 注入指纹、非硬编码（DOM 防造假，Golden Path Step 6 / AI_ADDED）
  Test: manual:bash -c 'cd apps/dashboard && npx vitest run src/pages/harness-pipeline/__tests__/PipelineLifecycle.test.tsx -t "PrepPRD 渲染等于DB注入指纹非硬编码"'
  期望: exit 0

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑 — mac_web Playwright）

- [ ] [BEHAVIOR:E2E] 用户打开 /pipeline/:id → 文档 Tab，走完全生命周期视图，**三项非 prep 分区真实 DB 接线交叉校验** + 截图可视化验证
  Screenshots:
    - 01-initial.png   期望：pipeline 详情页初始加载，标题与 Tab 可见，无白屏/报错
    - 02-action.png    期望：点击「文档」Tab 后，七项生命周期分区按序渲染
    - 03-result.png    期望：PrepPRD/正式 PRD/Contract 分区显示 DB 真实正文（含 Markdown 标题），Report 分区显示「未到该步」，全页无「文件不存在」
  路径格式：sprints/06181500-cockpit-phase2-lifecycle/screenshots/<step>.png
  期望（修 Reviewer Round 1 verification_oracle_completeness=6 — 不再只校验 PrepPRD）：
    1. evaluator 注入的 PIPELINE_ID 必须是「已跑到 contract 收敛」的 run（`/api/brain/harness/initiative/:id/detail` 返回非空 prd_content 与 contract_content），否则脚本 step 0 直接 FAIL。
    2. Playwright 取 `/initiative/:id/detail` 的 prd_content/contract_content head，断言 sprint_prd 分区 `toContainText(prd head)`、contract 分区 `toContainText(contract head)`，且二者均 `not.toContainText('取数失败')`——证明至少两条非 prep 分区真实 DB 接线（接线接错 → 分区显示「取数失败」→ 断言 FAIL，不再全绿）。
    3. PrepPRD 分区 `toContainText(prep head)`（来自 /api/brain/tasks payload.prep_prd_body）。
    4. Report 分区「未到该步」、`body.innerText` 不含「文件不存在」。
    5. Claude Read 图自验通过。
