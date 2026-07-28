# Kernel Attempt Result Channel Bootstrap PRD

## 背景

Kernel Fleet Attempt 已能创建独立 workspace、启动 provider-neutral Runner 并向
Brain callback，但 TaskBundle 没有服务端拥有的结果通道。Runner 只相信 provider
stdout；Reviewer/Evaluator 等 Skill 写入的 `.brain-result.json` 可能落在只读
`/workspace`，且 Worker 在 callback 未持久化时仍会删除容器、runtime 与 workspace。
这会让真实 verdict 丢失，也使 Kernel 无法安全地自举后续 Golden Path × 11 要素。

## 目标

建立一条由 Brain 生成、TaskBundle 冻结、Fleet Worker 验证、Runner 写入、Brain
按 Attempt 权威字段校验并回执的 durable result channel。Callback 暂时失败或
Worker 重启时，结果证据必须保留并可重放；只有收到与 Attempt 和 body digest
精确匹配的 durable receipt 后才允许清理。

## P0 行为合同

1. Brain 为每个 Fleet Attempt 生成唯一、绝对、位于既有 writable runtime mount
   内的 result path，并在 TaskBundle 中冻结版本、路径和字节上限。
2. Transport 只发送白名单 result channel；Worker 校验 Attempt/Run/Task/Role/Lease
   绑定并注入真实 `CECELIA_TASK_ID`、`BRAIN_RESULT_FILE` 与 channel metadata。
3. Reviewer/Evaluator 等 Skill 的文件输出优先于不含 verdict 的 provider 摘要；
   Runner 对 raw bytes 限长、拒绝 symlink/旧 Attempt 证据，并生成 SHA-256。
4. Callback 不信任 Agent 自报权威字段；它必须与 `harness_attempts` 和冻结
   `task_bundle` 的 task/run/attempt/role/lease/session/contract/PR/skill 绑定一致。
5. terminal result 与 receipt 同一条持久化写入；相同 digest 重试返回同一 receipt，
   不同 digest 重试返回 409。
6. Brain ack 必须回读 exact attempt/run/worker/job/lease/digest/delivery/status，并
   由 Fleet transport secret 做 domain-separated receipt HMAC。只有 Worker 验签
   accepted/deduped receipt 后才允许清理。
7. callback 失败时 Worker 删除已退出容器但保留 runtime/workspace/state，进入
   `callback_pending`；Worker 重启后使用节点 transport 身份和 mode 0600 的受限
   replay envelope 重试，不持久化 per-Attempt callback token。
8. receipt 验证成功后 container/runtime/workspace/state 恰好一次清理。
9. Claude、Codex、Grok 使用相同 result-channel 协议；legacy 非 Kernel 路径保持兼容。
10. Fleet launch 与 Docker env/state 不再携带 per-Attempt callback token。Callback
    与 heartbeat 由 Worker 使用 file-backed 节点 transport 身份签名；provider
    只写 result/session 文件，永远看不到节点 secret。
11. migration history 必须从空库可复现：forward-only migration 放宽
    `harness_attempts.execution_transport` CHECK 以接受 `fleet-worker`，不得依赖生产手改。

## 非目标

- 不改变 Kernel 的 Generator/CI/Evaluator/Judge/人工审批/merge/promotion 顺序。
- 不在本 bootstrap 中合并 PR 或绕过 draft、人审、CI、Evaluator。
- 不把 workspace 内旧 `.brain-result.json` 当成 Kernel 权威结果。
- 不修改生产数据库 fixture；PG 测试使用既有 test DB 或 mock transaction boundary。

## 成功标准

- 新增的生产 seam 测试先 Red 后 Green，覆盖正常回执、只读 workspace、缺文件、
  oversized/symlink、binding mismatch、same/conflicting digest、callback 失败、
  Worker restart replay 与 ack-gated cleanup。
- 原 execution-contract、dispatcher、transport、callback、Fleet Runner 和
  entrypoint targeted regression 全绿。
- Brain 版本与 `DEFINITION.md` 同步；只开 Draft PR，等待 CI、Evaluator 与人工批准。
