## Brain {VERSION} — grok 同步器读错配置文件：漏掉的 agent 不在分母里，日志永远显示全绿

- `~/.openclaw` 下有两份配置：`openclaw.json` 是**真身**（`openclaw config set` 写它），`clawdbot.json` 是旧名、9-21 后就没更新。
- 同步器读的是 `clawdbot.json`（23 个 agent），而真身有 **24 个**——新加的 `newmedia` 永远同步不到 grok token，几小时后必然 403。
- **最坏的一种假绿**：漏掉的 agent 不在分母里，日志照样打「同步完成：成功 23 个，失败 0 个」，退出码 0。计数正确，样本不全。
- 改为优先 `openclaw.json`、回退 `clawdbot.json`。守卫第 ③c 条**测行为不测字面量**：造两份配置各放一个独有 agent，看脚本同步了谁；已变异验证（退回只读旧文件即报红）。
