# Red Evidence

- 命令：`npx vitest run sprints/kernel-final-codex/tests/kernel-ping.test.js --reporter=json`
- exit_code：1
- 结果：4 条测试中 3 failed / 1 passed
- 根因：`GET /kernel-ping` 尚未注册，三个成功路径断言收到 Express 404；通过项只覆盖合同要求保持不变的 POST 404 与既有 `/ping`。
