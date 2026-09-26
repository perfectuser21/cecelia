# Learning: 棒1 回执线——回执丢 stage/metrics + execution-callback 无鉴权

任务 15346e6c · 决策 702949b6/280bd091 · 链 bf5088a3

### 根本原因

- `recordRunFromCallback` 只把 `exit_code` / `artifacts` / `pr_url` 交给 `finishRun`，回执 `result` 里账本每个 stage 落的 `stage/stage_status/metrics/evidence/probes` 在这一跳被丢，Brain 的 `task_runs` 看不见获客链的阶段进度。
- `POST /execution-callback` 是唯一 status+result 写入点却没有任何鉴权；`internalAuthOrLoopback` 早已有现成件（/llm-service 在用），只是没挂到这条路由。
- 10 个 mock 路由的旧测试用 `route.stack[0].handle` 取业务 handler，一挂中间件全部取到中间件——测试与实现耦合在"路由只有一个 handler"这个隐含假设上。

### 下次预防

- 生产 `NODE_ENV=production` 且已注入 `CECELIA_INTERNAL_TOKEN`（本次 `docker exec` 实证），挂闸前必先确认所有内部调用方带头，否则上产即 401 全线回执失败：本次 grep 全仓 `execution-callback` 枚举调用方（cecelia-run.sh / flush / executor codex fetch×2 + 本地 codex curl + docker env 透传 / bridge / verify 脚本），smoke 与单测都用 readFileSync 钉住接线。
- 取业务 handler 用 `route.stack.at(-1)`，不用 `[0]`。
- `finishRun` 只加 `result` 入参、SQL 不动（`COALESCE(result,'{}') || $3` 已是合并语义），棒3a 在同函数加事件时不撞。

- [ ] zenithjoy `brain-device-job-mirror.ts:103/140` psql 直写 tasks 绕过 task_runs，本棒未修（下一棒）
