## Brain {VERSION} — coding workflow 固化前逐条预跑回归 smoke，API 类 PR 零固化拦合并

- `runner/lib/qa-gate.mjs` 新增 `preflightSmoke`：裁判 PASS 后，每条可固化的 T-n 用 `bash -c` 单独在预览上跑一遍（`BRAIN_URL=预览地址`、`SMOKE_ALLOW_WRITE=1`、60s 超时），失败的剔除并记 `preflight_failed:<退出码|timeout>`，剩下的重新组装再登记；预览地址命中生产判定时一条都不跑、全部剔除
- smoke_note 带上「预跑 N 条通过 M 条」与每条被剔除的原因
- 新规则（决策 4fe863c3，推翻 b8030661）：PR 改了 API 面（`lib/pr-kind.mjs` 新增 `touchesApiSurface`：Brain `src/routes/`、`routes.js`/`*-routes.js`/`*-route.js`、`server.js`、`apps/api/src/`，不含测试）且 QA 有 PASS 的 API 条目、但最终一条都没固化（分支上也没有前轮版本）→ 记 `smoke_missing`，不批准，升级 `qa_smoke_missing` 交 coding commander
- commander 处理 `qa_smoke_missing`：裁决「放行」（必须写理由、不改代码）→ 批准裁决记录推送后的 head，理由记 `smoke_waived` 与 smoke_note；否则只解除升级，head 已变，QA 门按新 head 重跑
- `prompts/evaluate.md` 补地址变量写法约定（同一条命令里赋值、T-n 不打本机其他端口、对比基线写 X-n）；`prompts/commander.md` 补 qa_smoke_missing 裁法
- 修 `qa-gate.mjs` readState 的重复 `rounds` 键（eslint no-dupe-keys）；`proc.mjs` 的 `run` 支持 `env`
- 运行时口径：runner 每 300s 自更新到 origin/main，合并后下一轮起生效；在途 #6319 只改迁移，不触发零固化拦截
