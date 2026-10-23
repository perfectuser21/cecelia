# 秋米执行参数与会话账号绑定

以下正文可复制到中文任务页。中文页设为「委派」，任务号留空；现有镜像生成英文页后，核对 Description 含 `[zh:<中文页ID去连字符后的32位小写值>]`、Status 为 `Delegated`，并等待 `brain:<task_id> ✓已接管` 回执。正文上限为 20,000 字；超限时在同一中文页缩短。已接管后若需修正，在原中文页改正文，再对原 task_id 派发，不复制新任务。

```text
【执行设置——启动前落实】
AI账号：openai-plus3
【执行参数】
执行Agent：skill-factory
模型：openai/gpt-6.1-sol
超时：30分钟
思考强度：high
【执行参数结束】

【执行要求】
调用Skill：<实际 Skill 名称>
输入：<无害或已授权的任务输入>
业务结果回填：<目标和格式>
运行结果回填：<目标和格式>
验收：<可核对的结果>
```

另一种账号写法只替换一行：`AI账号：openai:xuxiao21xx@icloud.com`。`Codex team2` 等编号必须先取得明确映射，不能猜 profile。硬执行参数是执行 Agent、模型、超时、思考强度与显式 AI 账号；Skill、输入、两类回填、验收及执行要求属于业务正文。

指定账号时，执行机先调用 Gateway `sessions.patch`，把 `模型@profile` 写入本次独立 session，并核对读回的账号、模型及 `authProfileOverrideSource=user`。成功后在同一 session 启动 Agent，不再用 `--model` 覆盖绑定；绑定失败或读回不一致时不启动 Agent。

绑定事实存于 `~/brain-runs/<run_id>.binding.json`；运行事件记录指定 profile 和回执位置，不记录 token。编号别名通过部署配置 `QIUMI_AI_ACCOUNT_MAP` 映射到已核对身份的 profile，没有明确映射就拒绝，不能仅凭邮箱推断工作区或额度。

旧正文漏写结束标记时，业务字段及后续执行要求仍会保留；新任务建议显式结束参数块。上述行为以包含此修复的生产版本及实际回执为准，模型最小调用不等于云手机业务已完成。
