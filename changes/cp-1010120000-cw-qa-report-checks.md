## Brain {VERSION} — coding harness：QA 报告校验加严（验不了第三态 / 恒真断言 / 截图 / 不许降级）

- 决策 a1fdbc51 审计 P2 批次 C，对应旧 evaluator / proposer 规矩：
  - #38 + #19：QA 的 T-n 可判 `CANNOT_VERIFY`，必须写 `原因:`（例如工具缺失），不许换更弱的测法凑 PASS。整份报告有 FAIL 时按 FAIL 进修复环；没有 FAIL 但有验不了的 → verdict `CANNOT_VERIFY`，QA 门不进修复环（否则无限改代码），升级 `qa_cannot_verify` 并带上条目与原因。04 开发自测证据仍只认 PASS/FAIL。
  - #36：判 PASS 的命令带 `|| true`、`; exit 0`、`--dry-run`，或只有 echo/printf/true → 报告不合格（`qa_trivial_assertion`），带原因重跑。
  - #37：报告 `截图:` 引用的文件必须存在；用了浏览器（命令或本次会话写的脚本引用 playwright/chromium/puppeteer）的条目，本轮截图目录必须至少有一张图，否则 `qa_screenshot_missing`。DB 断言带本轮时间窗写进 prompt。
  - #17 + #18：异步/外部类场景跑两次，结果不一致判 FAIL（FLAKY）；页面类场景每个 Q-n 用全新浏览器上下文（写进 evaluate prompt）。
