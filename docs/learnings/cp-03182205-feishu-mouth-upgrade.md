# Learning: 飞书嘴巴升级 (cp-03182205-feishu-mouth-upgrade)

## 根本原因

1. **thalamus 模型依赖单一 provider**: llm-caller.js 之前只支持 anthropic/bridge/minimax，新增 openai provider 需要 credential 加载逻辑和 GPT-5 专用 token 参数（`max_completion_tokens` vs `max_tokens`）。
2. **P2P 消息无防抖**: 用户快速发多条消息时每条都触发完整 LLM 链路，浪费资源且回复割裂。
3. **丘脑决策缺少直接回复字段**: 之前 thalamus 只做路由决策，没有 mouth_reply/need_card，导致飞书回复需要单独再调一次 handleChat。
4. **正则贪婪 vs 非贪婪**: 非贪婪 `\{[\s\S]*?\}` 无法处理含嵌套对象的 JSON（停在第一个 `}`），改为"从末尾往前扫描"方式可同时处理嵌套 JSON 和多 JSON 对象场景。

## 下次预防

- [ ] 新增 provider 时同步更新 llm-caller.js + 测试（测试中 openai 之前测 "Unsupported"，需要随代码改变）
- [ ] P2P 和 group 消息处理都需要防抖窗口，开发时一起考虑
- [ ] 丘脑 prompt 格式变更必须同步 parseDecisionFromResponse 的健壮性
- [ ] git worktree 可能被 cleanup-gc-auto 清理，重要改动要尽快 commit push，不要长时间搁置在未提交状态
