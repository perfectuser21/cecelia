### R-1
处理: 采纳
说明: 核实成立：`packages/brain/src/__tests__/routes/task-tasks.test.js:115,123` 用 `non-existent` / `t1` 做 GET，加 UUID 前置校验后会变成 400。另外查到 QA 没列出的同类问题：`src/__tests__/integration/brain-endpoint-contracts.test.js:155,170`（`task-contract-001` / `nonexistent-id`，同样挂 task-tasks 路由、mock DB），也会变红。S-2 的"改动文件"已加上这两个测试文件，把这 4 处 id 换成合法 UUID，断言保持 404 / 200 不变。全仓库 grep 过，只有这 4 处；`agent-lifecycle`、`task-status-transitions`、`golden-path` 集成测试的 id 来自真实 PG 插入，本来就是 UUID，不受影响。验证：`npx vitest run src/__tests__/task-get-invalid-id.test.js src/__tests__/routes/task-tasks.test.js src/__tests__/integration/brain-endpoint-contracts.test.js` 全部通过。

### R-2
处理: 采纳
说明: 确实有一个没闭合的单引号，zsh 会卡在 `quote>`。Q-3 第 4 条已改为整串加双引号、单引号写成 `%27`：`"http://localhost:5221/api/brain/tasks/%27%20OR%201=1--"`，期望不变（400，且不回显注入串）。
