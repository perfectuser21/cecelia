# DoD：批量删除 4 条 dashboard 死页孤儿测试，止血 main brain-unit

分支: cp-06031103-rm-orphan-page-tests

## 背景

War Room「删历史死页」系列 PR（#3258 等）退役了多个 dashboard 页面
（`HarnessPipelinePage.tsx` / `HarnessDetailPage.tsx`），但**漏删散落在 sprints/ 各处的配套测试**。
这些测试 `readFileSync` 已删的页面文件 → ENOENT 抛错 → brain-unit 全红，逐条把 main 拖红
（#3260 删了第 1 条 HarnessStreamPage 孤儿，rebase 后又踩到 HarnessDetailPage 孤儿）。
本 PR 一次性扫掉 4 条死引用孤儿测试，彻底止血。

## 改动（仅删 4 个测试文件，不碰任何代码）

- [x] [BEHAVIOR] 4 条 readFileSync 已删页面的孤儿测试全部删除（brain-unit 不再被它们拖红）
  Test: manual:node -e "const fs=require('fs');const o=['sprints/tests/ws2/ws-progress-ui.test.ts','sprints/cecelia-harness-viz/tests/ws3/WsProgress.test.tsx','sprints/cecelia-pipeline-viz-v2/tests/ws3/initiative-detail-panel.test.ts','sprints/cecelia-sprint-visibility-0528/tests/ws4/harness-detail-docs-tab.test.tsx'];for(const f of o)if(fs.existsSync(f))process.exit(1)"

## 验收

- [x] 4 条孤儿删除前均确认：目标页面（HarnessPipelinePage.tsx / HarnessDetailPage.tsx）在 main 已不存在
- [x] 仅删测试文件，不动任何 Brain/dashboard 代码（最小手术）
- [x] 删后 brain-unit 转绿（本 PR 自身 CI 验证）
