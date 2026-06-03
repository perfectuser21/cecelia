# DoD：删除 WS3 孤儿测试，解锁 main brain-unit

分支: cp-06031039-rm-ws3-orphan-test

## 背景

#3258（War Room PR-C「删历史死页」）退役了 `apps/dashboard/src/pages/harness/HarnessStreamPage.tsx`，
但漏删它配套的测试 `sprints/tests/ws3/harness-stream-page.test.ts`（#2986 加的 WS3 TDD 测试）。
该测试 7 条断言里 6 条 readFileSync/existsSync 已删的页面文件 → brain-unit 全红，
**所有拉新 main 的 brain PR 都合不了**。本 PR 补完 #3258 的清理，删掉这条远程孤儿测试。

## 改动

- [x] [BEHAVIOR] 孤儿测试文件 `sprints/tests/ws3/harness-stream-page.test.ts` 已删除（brain-unit 不再被它拖红）
  Test: manual:node -e "if(require('fs').existsSync('sprints/tests/ws3/harness-stream-page.test.ts'))process.exit(1)"

## 验收

- [x] 仅删一个文件，不碰 Brain/dashboard 任何代码（最小手术）
- [x] 删除前确认：HarnessStreamPage.tsx 确已不在 main（#3258 退役），整文件 7 条断言均依赖该页
- [x] 删后 brain-unit 转绿（本 PR 自身 CI 验证）
