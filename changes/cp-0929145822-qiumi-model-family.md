## Brain {VERSION} — 秋米模型写系列名自动取最新版本

- 【执行参数】模型字段支持系列名：Sol / Terra / Luna / Astra / Opus / Sonnet / Fable / Haiku / Grok，取允许清单内该系列最新纯版本号型号；新版本进清单即自动成为默认（决策 49d17c60，任务 c271d6a8）。
- 具体型号支持显示名写法（「GPT-6 Sol」「Opus 4.8」「Grok 4.6」），claude/codex 简称兼容为 Sonnet/Terra 系列最新。
- 生产允许清单（us-vps .env.docker）按 MMV 实测收敛为 21 个：补 openai/gpt-6-sol；剔除实测失败的 claude-opus-5-5、grok-4.5、grok-4.20-non-reasoning、grok-4.20-multi-agent。
