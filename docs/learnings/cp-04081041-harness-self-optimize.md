### 根本原因

Harness v4.0 初版（PR #2000）存在五个健壮性缺陷：

1. **GAN 对抗无上限**：`harness_contract_propose ↔ harness_contract_review` 对抗没有轮次上限，Reviewer 反复 REVISION 会导致死循环。

2. **CI watch 超时直接 fail**：`poll_count >= 120` 时直接把任务标为 `failed`，整条链路中断，浪费了已经写好的 Generator 代码。

3. **harness_fix 后 pr_url 未覆盖测试**：代码逻辑正确（从 result.pr_url 提取），但没有测试覆盖，容易在重构中悄悄回归。

4. **deploy_watch 超时路径无测试**：降级逻辑存在但无测试，同上风险。

5. **CI watch 每次 tick 都调 GitHub API**：Brain tick 每 5s 一次，`checkPrStatus` 也 5s 一次，对 GitHub API 压力过大，会触发 rate limit。

### 下次预防

- [ ] 新增轮询类任务时，必须同时设置 `POLL_INTERVAL_MS` 节流 + `lastPollTime` Map
- [ ] 任何超时路径不能直接 `failed`，应降级到下一步（链路连续性原则）
- [ ] GAN 对抗类任务必须有 `MAX_ROUNDS` 常量防死循环
- [ ] 新增 `harness_*` 处理路径时，需同步增加对应测试（合同 Feature → 测试覆盖 1:1）
