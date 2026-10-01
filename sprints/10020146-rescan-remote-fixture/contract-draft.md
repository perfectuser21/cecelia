# Contract — rescan远端SHA夹具隔离

只改测试与CI登记。固定测试ls-remote，其他git真实转发；产品脚本不变。使用原有可注入锁路径在自有临时目录执行，保留默认锁与历史outer路径不同的约束，不宣称生产默认全局锁已经运行验收。

## Test Contract

| Workstream | Test File | BEHAVIOR | Red |
|---|---|---|---|
| 稳定远端推进夹具 | `scripts/__tests__/rescan-fixture-isolation.test.mjs` | rescan fixture stays deterministic when remote main advances and forwards other git commands | 0d25265610永久RED，原suite8通过4失败，/tmp/rescan79ed-red.log |
| 原生入口 | `sprints/10020146-rescan-remote-fixture/tests/rescan-remote-fixture.test.mjs` | native entry executes rescan remote race regression without skips | 委托永久边界测试，旧suite因推进非零退出，不能算原生成功 |

## E2E验收

```bash
npx vitest run sprints/10020146-rescan-remote-fixture/tests/rescan-remote-fixture.test.mjs --maxWorkers=1 --minWorkers=1
```
