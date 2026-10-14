## Brain {VERSION} — 修复只读验收的浏览器截图误判

- 完整解析有限只读断言，文档中的 Chromium / Playwright 词汇不再强制无关截图；真实浏览器及未知形式维持原证据要求。
- 固定 Acorn 8.16.0 与 Playwright 1.62.1 运行依赖，并在 Codex 常驻预检拒绝缺失或错版解析器。
