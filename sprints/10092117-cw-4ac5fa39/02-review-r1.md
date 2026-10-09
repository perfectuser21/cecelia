---
task_id: 4ac5fa39-521e-48b8-8b1a-ae1b79bcba2d
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 9
可验证: 8
场景覆盖: 8
回归风险: 5
可执行: 7

### R-1
针对: S-1, S-2
严重度: 重要
场景: 开发方照 S-1 加上 UUID 前置校验后推 PR，brain-ci 跑现有单测 `src/__tests__/routes/task-tasks.test.js`，其中 `GET /tasks/non-existent` 期望 404、`GET /tasks/t1` 期望 200（返回 title），两条都会变成 400 而失败，CI 红、走不到真人 QA。
依据: `packages/brain/src/__tests__/routes/task-tasks.test.js:113-126` 用的是非 UUID 的 id（`non-existent`、`t1`）做 404/200 断言；S-1 第 2 步让非 UUID 直接返回 400、不查库；S-2 写的是"`task-tasks.js` 中原有的 404 逻辑不改"，但没提现有测试要随之调整，"改动文件"清单里也没有这个测试文件。
说明: 在 S-1/S-2 的"改动文件"里加上 `packages/brain/src/__tests__/routes/task-tasks.test.js`，把这两条用例的 id 换成合法 UUID（例如 `00000000-0000-4000-8000-000000000000` 和一个 uuid 版的 t1），断言保持 404/200 不变；验证命令里也要跑这个文件（或者直接跑 `npx vitest run src/__tests__/routes/task-tasks.test.js src/__tests__/task-get-invalid-id.test.js`），证明没有回归。

### R-2
针对: Q-3
严重度: 建议
场景: QA 把 Q-3 第 4 条原样贴进 zsh 执行 `curl -s -w '\nHTTP=%{http_code}\n' http://localhost:5221/api/brain/tasks/'%20OR%201=1--`，因为 URL 里有一个没闭合的单引号，shell 停在 `quote>` 等待输入，请求根本没发出去，这一条没法照做。
依据: Q-3 操作第 4 条的 URL 路径里带了一个裸 `'`，没有做转义或整体加引号。
说明: 把这条改成整串加双引号，并把单引号写成 `%27`，例如 `curl -s -w '\nHTTP=%{http_code}\n' "http://localhost:5221/api/brain/tasks/%27%20OR%201=1--"`，期望保持 400 且不回显注入串。
