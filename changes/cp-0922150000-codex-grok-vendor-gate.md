## Brain {VERSION} — codex/grok 在生产恒判 0 可用：vendor 层读的是容器里不存在的本机凭据文件

- 实证：7 天 61 次派单 **61 次全落 claude**，5 个 codex 号和 grok 一次没被选过。
- 根因在 **vendor 层**不在选号层：`llm-capacity.js` 的 `pollCodexAccount` 读 `~/.codex-teamN/auth.json`、`pollGrokLedger` 用 `existsSync(~/.grok/auth.json)`，而 Brain 跑在 us-vps 容器里，`/root/.codex*` `/root/.grok*` 根本不存在（ssh 实证）→ `available_count` 恒 0 → `chooseGuidedExecutor` 在 vendor 层就把两家整个排除。**刀1 接进 capability-gate 的配额账本对这 6 个号根本没机会生效**——闸门装在了一扇已经焊死的门后面。claude 那条能通只是因为它走 `getAccountUsage()` 读 `account_usage_cache` 表，压根不碰本机文件。
- 修法：codex/grok 改读 `ops_model_accounts`，判据**复用** `createQuotaLedgerLoader` + `judgeAccount`，不另发明第二套（#5472 教训：同一个号在 vendor 层和选号层必须得出同一结论）。`unknown` 按三态语义弃权（视为可试），只有 `unusable` 才扣可用数——把「读不到数据」压成「没额度」正是 0819 三起事故的形状。
- 装载器自身起不来时同样退回 unknown 弃权、账号列表保持完整，只把降级原因挂到 `poller`/`error` 上；绝不让 vendor 塌成「一个号都没有」。
- 守卫 4 项变异逐个实跑验证被抓。**其中一项返工**：装载器故障那条断言最初喂的是手造快照，改 `loadQuotaSnapshot` 照样全绿——测的是自己的输入不是代码行为；改到 `llm-capacity-pool.test.js`（fs 被 mock，天然是装载器起不来的真现场）才咬得住。
