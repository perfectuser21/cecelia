## Brain {VERSION} — 凭据保鲜守卫（活性探测 + auth key 自动续期）

- 2026-09-16/17 一夜撞出三条实证：Tailscale API key **过期 18 天没人知道**（直到 CI 红了才反查出来）；1Password 里的备用 GitHub PAT **元数据什么都没写、实际早已 401**；99 个凭据条目里**只有 1 个**写了到期日。
- 由此定下判据：**读元数据只能抓到"老实写了到期日"的那一个**，真相必须靠"定期真去用一次"。新增 `credential-freshness.js`，每日探活 Tailscale API / GitHub PAT / 飞书 app 三类凭据，失活即 P1 告警；元数据用于提前 14 天预警，两条腿都要有。
- 几处刻意的判定选择，都对应实际踩过的坑：无到期信息判 `unknown` 而非 `ok`（今晚出事的正是"没写"那把）；探测出错算失活而非通过（宁可误报不可漏报）；到期日未知时**不**自动续期（否则每轮重发新 key 把旧 key 冲掉，比不续更糟）。
- **CI auth key 自动续期**：剩 14 天时用 API token 自动签发新 key，能力与现用一致（`reusable`+`ephemeral`+`preauthorized`，缺一项则 CI 连不进来或在设备列表堆僵尸节点）。真调 Tailscale API 验证过签发与删除权限。
- **API token 自己不能自续**（Tailscale 安全设计，不允许旧 token 生成新 token），因此改为到期前 14 天给出可照做的人工步骤，并注明"CI 的 auth key 会自动续、不用管"，避免重复劳动。主理人要盯的从"随时可能爆的一堆"收敛成"90 天一次、有预告的一件"。
- 顺带修正：1Password 里 `TAILSCALE_TAILNET` 记的是占位值 `xx@gmail.com`，用它调 API 报 `tailnet not found`；正确用默认 tailnet `-`，已用 `_V2` 字段记下。
- 配 `credential-freshness-smoke.sh` 并登记 allowlist，两道闸 proven-to-fire。
