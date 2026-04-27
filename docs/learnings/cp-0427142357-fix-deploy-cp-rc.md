# Learning: brain-deploy.sh cp identical 中止 Phase 9-11（2026-04-27）

- 影响：deploy 链路 + post-deploy smoke 实际从未真跑
- 触发：今天 redeploy Brain 时发现 [8/8] 之后无输出

---

### 根本原因

`brain-deploy.sh` 顶部 `set -euo pipefail`。两处 `cp $SRC $DST` 当 SRC==DST（identical files）时 macOS `cp` 返 rc=1，set -e 立刻中止。

后果：Phase 9（cecelia-bridge update）/ Phase 10（Notion sync）/ Phase 11（**post-deploy smoke**）全部静默不跑。

PR #2655 cicd-C 我加 Phase 11 时**完全没察觉这个盲点**。表面上 Phase 11 写得很完整（扫最近 5 PR 的 smoke.sh + 真跑 + 报失败统计），但 Phase 8 的 cp 失败让 Phase 11 永远到不了。**这是"机制写好但实际从未生效"的典型** —— 本来 cicd-C 是为了验证 Tier 0/1/2 真路径，结果它自己就是"虚的"。

---

### 修复

`cp ... || true` 兜底（2 处 cp + 1 处 chmod）。

---

### 下次预防

- [ ] 任何"机制做完了但表面看不到效果"的功能，必须有"我亲眼看到它真跑"的证据。Phase 11 加完后我应该立刻 deploy + 看输出，而不是相信"应该会跑"
- [ ] 任何 deploy 步骤的 `set -e` 路径必须配套实测：mock 各种返回码场景看脚本不该中止的地方有没有中止
- [ ] macOS cp/mv 在 source==dest 时返 rc=1 是平台特性，shell 脚本里所有"自更新"模式必须 `|| true`
- [ ] 这个 bug 早就存在了（PR #2655 合到现在 3 天），没人发现说明 deploy 后没人对 Phase 9/10/11 的输出有期待。是 cicd-C 的设计缺陷：必须有"deploy 后必跑 11 phase"的契约校验
