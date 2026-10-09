# 秋米路由认「用 <型号>」：模型允许清单显式命中（2026-09-23）

## 根本原因

- Brain 路由把「模型」硬写成 claude / codex / terra 三个引擎，而 OpenClaw 同日已把允许清单扩到 26 个型号（Grok 4.7/4.6/4.20/build、Claude opus-5/haiku/sonnet、GPT 5.5/5.6 三档）并逐个实调通——两边不是一张表，员工在 Notion 里写「用 grok-4.7」Brain 一个字都不认。
- `claude` 引擎映射到 `claude-cli/claude-sonnet-5`，该通道 0923 实测任何型号 180 秒无输出（gateway.log `cli watchdog timeout`）；另一会话早上 10:05 已把 sonnet-5 运行时切到原生 Anthropic API 并验证通，Brain 侧没跟着改。
- 终审抓到三处：正文「不用 grok-4.7」被当成指定（ENGINE_RES 早有 `(?<!不)` 先例没抄）；生产 env 清单里我手抄时把 opus-4-7 / sonnet-4-6 各写了两遍，`exact>1` 把重复当歧义静默回落默认模型；型号名大小写敏感（「用 Grok-4.7」不认）。
- 三个 `feat(brain):` commit 触及 brain/src → `lint-feature-has-smoke` 要新 smoke，新 smoke 又要登记 `packages/quality/smoke-allowlist.txt`（上一刀因未登记被 Smoke Ratchet 打红一次）。

## 下次预防

- [ ] 「清单不手抄」要落到运行时：`QIUMI_MODEL_ALLOWLIST` 现在仍是运维手同步到 us-vps env——下一步让 Brain 直接从 OpenClaw 配置拉，或加一条校验 job 比对两边差异
- [ ] 手写 JSON 数组进 env 前先去重（`sort -u`），代码侧 `Set` 去重已加
- [ ] 正则匹配自然语言指令时，负向词（不/别/勿）与大小写两条一起写进用例，别等审查
- [ ] 一个通道被判死（claude-cli），所有映射到它的默认值同刀改掉，别留给下一次事故
- [ ] `feat:` 前缀 + brain/src 改动 = 必带新 smoke + 登记 allowlist，两步一起做
- [ ] 留观：纯英文常用词做短名后缀会顺带命中（「用 agent」→ grok-4.20-multi-agent），一周内看有没有误命中再决定加停用词
