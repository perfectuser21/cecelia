# Contract — 看门狗PG全天与精确边界增强

任务7a8a09a6-b00c-4cf0-b182-acebeb7fef8e。main537ff5已合并基础自然日/设备分离修复，本次仅增强UTC测试时间解释、全天与精确24h边界。只改测试夹具；不改产品SQL、24h阈值或松断言。UTC测试连接的无时区列解释与CI一致，北京自然日统计、设备过期状态使用独立serial与时间。验收包括北京5个时刻、25h stale、1h fresh、恰好24h、超过1ms、idle和当日去重。永久原测试在Brain真实PG CI运行；缺数据库或skip不能算通过。

## Test Contract

| Workstream | Test File | BEHAVIOR | Red |
|---|---|---|---|
| PG自然日与24h边界 | `packages/brain/src/__tests__/commander-watchdog.pg.integration.test.js` | 设备成功批恰好 24h 不叫，超过 1ms 才叫；近期无批设备不叫 | 历史基础修复RED7dd5d5aba2（主线已修），UTC真实PG 3失败4通过，北京0/6/12时原共享夹具误判；/tmp/watchdog7a8a-red.log |
| 原生验收入口 | `sprints/10020020-watchdog-time-fixture/tests/watchdog-time-fixture.test.mjs` | native entry executes all permanent PG cases under UTC and Shanghai without skips | 委托同一永久PG套件，历史旧共享夹具子进程非零退出；新scope检全部8项与两个时区 |

## E2E验收

```bash
DB_NAME=cecelia_scratch npx vitest run sprints/10020020-watchdog-time-fixture/tests/watchdog-time-fixture.test.mjs --maxWorkers=1 --minWorkers=1
```
