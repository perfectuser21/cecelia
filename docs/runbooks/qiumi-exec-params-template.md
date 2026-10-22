# 秋米执行参数模板与当前阻断

以下正文可复制到中文任务页。中文页设为「委派」，任务号留空；现有镜像生成英文页后，核对 Description 含 `[zh:<中文页ID去连字符后的32位小写值>]`、Status 为 `Delegated`，并等待 `brain:<task_id> ✓已接管` 回执。正文上限为 20,000 字；超限时在同一中文页缩短。已接管后若需修正，在原中文页改正文，再对原 task_id 派发，不复制新任务。

```text
【执行设置——启动前落实】
AI账号：openai-plus3
【执行参数】
执行Agent：main
模型：openai/gpt-6.1-sol
超时：30分钟
思考强度：high
【执行要求】
调用Skill：<实际 Skill 名称>
输入：<无害或已授权的任务输入>
业务结果回填：<目标和格式>
运行结果回填：<目标和格式>
验收：<可核对的结果>
```

另一种账号写法只替换一行：`AI账号：openai:xuxiao21xx@icloud.com`。`Codex team2` 等编号必须先取得明确映射，不能猜 profile。硬执行参数是执行 Agent、模型、超时、思考强度与显式 AI 账号；Skill、输入、两类回填、验收及执行要求属于业务正文。

**当前状态：显式 AI 账号任务会在启动前拒绝派发。** OpenClaw 2026.9.8 的 `openclaw agent` CLI 没有独立 profile 参数；现有 Gateway/CLI 路径尚无经验证可绑定本次 session、禁止跨账号 fallback 且回报实际账号的接口。不得换模型、去掉账号或改共享 agent 的全局认证顺序绕过。待接口与隔离候选真链路通过后，才能启用派发。
