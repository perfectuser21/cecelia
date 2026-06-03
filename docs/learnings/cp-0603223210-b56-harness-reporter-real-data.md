## harness reporter 写真实数据（2026-06-03）

### 根本原因
`reportNode` spawn `harness_report` 子任务时 payload 只传了 9 个字段，没有 `gan_rounds`/`gan_cost_usd`，导致 SKILL 无法获取真实 GAN 轮次和成本。SKILL Step 6 是硬编码空模板，根本不查 Brain API，`harness-report.md` 和 `learning.md` 的内容每次都是假数据。

### 下次预防
- [ ] 改 reporter 后在真实 run 里验证 harness-report.md 的 GAN 轮次字段是否正确
- [ ] check-cleanup.sh 需检查 `hooks/VERSION` — 这次漏了这个文件导致多一个 patch 提交
- [ ] Engine 版本 bump 时用 `bash scripts/check-version-sync.sh` 是不够的，要用 `check-cleanup.sh` 才能发现 hooks/VERSION
