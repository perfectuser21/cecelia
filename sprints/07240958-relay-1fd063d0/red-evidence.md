# Skeleton Red 证据

- 合同分支：`cp-harness-propose-r5-1fd063d0`
- 批准合同 HEAD：`523df37988e9aa7570050b60bafcc3145545f7a4`
- 最新 main/rebase 基线：`8812229b822a6e6be341c3f744a9b1e47958a495`
- 重放合同历史后的 HEAD（Red 提交前）：`70fc09ab2b1fa0ffe05ca776cfefae9c43e4c1c4`
- 共享棋盘：`tests/codex-slot-contract.test.ts`
- 棋盘 SHA-256：`ead49e665d904bcf9a4d40720782bad67ce5e1db5dec2720b765b44f7c0955e1`
- 批准合同与 rebase 后棋盘 blob：均为 `5f009c2ab6cc3714ac161df88958def344aafece`
- 覆盖 task-plan workstream：`ws1`、`ws2`、`ws3`、`ws4`、`ws5`、`ws6`

## 实跑命令

```bash
npx vitest run sprints/07240958-relay-1fd063d0/tests/codex-slot-contract.test.ts \
  --reporter=json \
  --outputFile=/tmp/codex-slot-red-report.json
```

## 结果

```text
exit_code=1
numTotalTests=11
numFailedTests=11
numPassedTests=0
numPendingTests=0
success=false
```

JSON reporter 正常落盘并被 Node 解析；11 条均进入 assertion result，失败消息均来自合同 `expect(...)` 断言，不是 parser、import、test collection 或 runner 崩溃。

## 11/11 失败断言

1. `旧 codex-request 合法参数在任何网络前 exit 64` — `expected 1 to be 64`
2. `旧 codex-remote-launch 合法参数在任何网络前 exit 64` — `expected 1 to be 64`
3. `全部生产 Codex credential consumer 都有 broker 或物理隔离 oracle` — consumer 缺 `codex-slot` broker 接线断言失败
4. `bridge/消费者删除 raw auth fallback 与 accounts 依赖` — raw auth fallback 禁止断言失败
5. `migration 用 account_ref 全局 blocking 唯一且不建 codex_slot_agents` — 合同 migration 文件存在性断言失败
6. `agent 身份容量复用 machine fleet slot SSOT` — broker 文件存在性断言失败
7. `authenticated frozen inventory cutover 与 durable crash restart smoke 存在` — smoke 文件存在性断言失败
8. `identity authority error matrix 与 stop 类型 exact，acquire stop reap 鉴权幂等` — route 文件存在性断言失败
9. `durable crash 重启覆盖每个写边界且禁止 unknown success` — smoke 文件存在性断言失败
10. `stop reaper schema副作用与连续失败P0回执 smoke 存在` — smoke 文件存在性断言失败
11. `六条 blocking invariant 含 INV-19 全消费者与 INV-27 双 Bash 真执行` — smoke 文件存在性断言失败

## 共享棋盘覆盖映射

| workstream | 对应断言范围 |
|---|---|
| `ws1` | 两个旧入口 fail-closed；migration 的全局 blocking lease 与 identity |
| `ws2` | frozen inventory/cutover、durable restart、API error matrix |
| `ws3` | machine/fleet/slot SSOT 与 installer 双 Bash 边界 |
| `ws4` | 生产 credential consumer broker/物理隔离、raw auth fallback 清除 |
| `ws5` | stop/reaper、protected delivery/launch、P0 receipt |
| `ws6` | lifecycle smoke、blocking invariants、最终 consumer/inventory oracle |

本棒只建立全红共享棋盘证据，不包含 Green、stub 或任何产品实现。
