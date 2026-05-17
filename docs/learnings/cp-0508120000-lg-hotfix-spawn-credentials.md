# cp-0508120000-lg-hotfix-spawn-credentials

**日期**: 2026-05-08
**触发**: W8 v7 acceptance task 跑到 sub_task fanout，spawn 容器 0.5s 崩，"Not logged in"

## 现象

Layer 3 spawn-and-interrupt 真的工作 — sub_task graph 用 `harness-task-ws1-r0-XXX` 命名 spawn detached 容器。但容器启动 0.5s 后 exit=1：

```json
{"result":"Not logged in · Please run /login","is_error":true}
```

## 根本原因

`spawnNode` 调 `spawnDockerDetached`，detached 内部用 `buildDockerArgs(opts)`。`buildDockerArgs` 看 `opts.env.CECELIA_CREDENTIALS` 决定加 `-v ~/.claude-accountN:/host-claude-config:ro` mount。spawnNode **没传 CECELIA_CREDENTIALS** —— 老代码（spawnGenerator）通过 spawn middleware chain 自动注入（account-rotation.js），**Layer 3 跳过了 middleware**。

## 修复

spawnNode 先 `resolveAccount(opts)` 选 account，把 CECELIA_CREDENTIALS + CECELIA_MODEL 加到 env 再传给 spawnDockerDetached。

## 下次预防

- [ ] 任何 detached spawn 都要先走 account middleware：不能直接绕过 resolveAccount
- [ ] 测试要包括 buildDockerArgs 出来的 mount 列表：单测断言 -v 含 host-claude-config

## 关联

- Layer 3 PR #2845 — spawn-and-interrupt 重构
- 本 hotfix — 修跨 middleware 漏注入 credentials
