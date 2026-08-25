# r74 Red 证据 — commander lease 过期有界自动重派

冻结实现（derive.js 未含 COMMANDER_INFRA_RETRY_CAP）下，三测试文件运行结果：

```

 Test Files  3 failed (3)
      Tests  6 failed | 12 passed (18)
   Start at  11:27:33
   Duration  260ms (transform 94ms, setup 1ms, collect 170ms, tests 20ms, environment 0ms, prepare 215ms)

```

6 failed 均为「commander infra 过期未达上限应不挂人审」用例（每文件 2 条）：
- frozen .test.ts: 单条 commander / 边界 累计4条
- gp/f1 commander: 单条 commander / 边界 累计4条
- route-unknown(#5058 更新): 单条<5 不挂人审 / 本地候选批准消费不再 wait
修实现（derive.js commander 有界重试）后转全绿 18 passed。
