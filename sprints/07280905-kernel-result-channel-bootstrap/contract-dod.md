# Definition of Done

- [ ] TaskBundle 对 Fleet Attempt 强制 `attempt-result-file/v1` result channel。
- [ ] Remote transport 与 Worker 都做严格字段白名单和 owner binding 校验。
- [ ] Worker 注入真实 task id；不再用 attempt id 冒充 task id。
- [ ] `BRAIN_RESULT_FILE` 落在现有 `/tmp/cecelia-prompts` writable mount。
- [ ] Runner 对 raw result 做 bounded regular-file/no-symlink 校验和 SHA-256。
- [ ] 六个 role 的业务输出通过 exact role adapter 保留，生命周期状态不冒充业务 verdict。
- [ ] Callback 使用 DB/TaskBundle 权威绑定并原子落 terminal result + receipt。
- [ ] 同 digest 幂等；conflicting digest 409；ack 含 exact receipt readback。
- [ ] callback 未 ack 时进入 durable `callback_pending`，重启可重放。
- [ ] per-Attempt token 不落 Docker env/state；Worker 用节点 transport 身份重放。
- [ ] ack 前不得删除 runtime/workspace/state；ack 后恰好一次清理。
- [ ] provider-neutral 与 legacy compatibility 回归通过。
- [ ] forward-only migration 让 fresh schema 合法写入 `execution_transport='fleet-worker'`。
- [ ] append-only receipt table 对同 generation/nonce 同 digest 幂等、异 digest 冲突。
- [ ] Brain 版本四处同步，`DEFINITION.md` 记录行为与回滚。
- [ ] Draft PR 创建；CI 与独立代码审查完成；merge 前停在人审门。
