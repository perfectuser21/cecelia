[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m
JSON report written to /tmp/red-report.json

## Red 判定（frozen 合同守恒式测试）
- 总计 5，passed 4，failed 1 —— 目标行为测试 "返回 publish 重派动作..." 为 RED。
- baseline derive('publisher', runner_failure) → phase='review' reason=callback_runner_failure_route_unknown（未命中 INFRA_RETRY_ACTION_BY_ROLE.publisher）。
- 其余 4 条为守恒/回归断言，baseline 即绿（补表前后均绿），符合 Test Contract。
