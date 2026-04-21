# Learning — Brain 出站飞书单一 gate（cwd-as-key 后第二条架构规则）

分支：cp-0421180232-brain-muted-gate
日期：2026-04-21
Task：091672a1-322a-441f-a124-3590b9374cbc

## 背景

Brain 向 Alex 飞书发送消息的频率失控——每分钟 1-2 条，24 小时不停。
已有 `CONSCIOUSNESS_ENABLED=false` 开关只覆盖"意识模块"，`alerting.js`
的 P0 告警绕过该开关直连飞书，管不住。

## 根本原因

三层叠加：

1. **开关粒度错**：`CONSCIOUSNESS_ENABLED` 只关意识层（proactive-mouth /
   self-drive / dopamine），alerting / content-pipeline / daily-report
   各自直接调 sendFeishu，**没有统一出口 gate**。
2. **P0 限流用 in-memory Map + Brain 频繁重启**：pre_flight_burst 每次
   重启立即发一条，5 分钟 rate limit 被重启清零 → 限流失效。
3. **arch-review 任务源头有 bug**：daily-review-scheduler.js 每 4h
   创建 arch_review task，payload 缺 prd_summary，触发 pre-flight
   拒绝 → 24h 累积 10 条 → 触发 P0 pre_flight_burst。

## 本次解法

**单一出口原则**：所有飞书主动 outbound 都经 notifier.js 的 sendFeishu /
sendFeishuOpenAPI 两个导出函数。gate 只放在这两个函数顶部：

- `BRAIN_MUTED=true` → 直接 return false，上游任何模块都被挡
- 其他值 → 走原路径

**不改上游**：alerting / proactive-mouth / self-drive / content-pipeline
等上游一律不动。一条线全守住。

**同时堵源头**：daily-review-scheduler.js INSERT 加 prd_summary ≥ 20 字符，
让 arch-review task 天然过 pre-flight，不再触发 burst 告警。

## Gate 语义边界（重要设计决策）

BRAIN_MUTED 只关**主动 outbound**，不关**对话回复**：

- `notifier.js::sendFeishu / sendFeishuOpenAPI` = 主动告警 / 推送 → gate 在这
- `routes/ops.js::sendFeishuMessage` = 机器人收到用户消息后响应 → **不加 gate**

原因：MUTED 如果也关对话回复，用户问 Brain "状态" 时机器人不回，调试更难。

## 紧急静默手册

运行时止血（不走 /dev，直接改 plist 重启 LaunchAgent）：

```bash
# 1. 加 env 到 plist
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:BRAIN_MUTED string true" \
  ~/Library/LaunchAgents/com.cecelia.brain.plist

# 2. 重启 LaunchAgent
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.cecelia.brain.plist 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cecelia.brain.plist

# 3. 验证新进程有 env（等 5s）
sleep 5 && launchctl procinfo $(pgrep -f 'brain/server.js' | head -1) | grep BRAIN_MUTED
```

恢复：plist 里 BRAIN_MUTED 改 false 或 PlistBuddy Delete 该条目，再次 reload。

### 下次预防

- [ ] 任何新增"Brain 对外推送"路径必须经 notifier.js（不允许直接 fetch feishu.cn）
- [ ] 新增 env 开关必须有清晰的**语义边界文档**（consciousness 管思考 / muted 管输出，两个维度不混）
- [ ] P0 级别的限流/状态 **必须用 DB 或文件持久化**，不用 in-memory Map（Brain 重启会清零）
- [ ] 定时任务派发器生成的 task 必须填 description 或 payload.prd_summary（否则 pre-flight 拒绝 → 告警风暴）

## 下一步（本 PR 合并后）

1. **立刻加 BRAIN_MUTED=true 到 plist** → 重启 Brain → 飞书静默
   （此时 arch-review 虽然已修但存量 queued/failed task 还在 DB 里，让 Brain 不发 P0 是最快止血）
2. **清理 DB 里过往 pre-flight 拒绝的 arch-review task**（单独 SQL，不在本 PR）
3. **观察一周** 确认 arch-review 新生成的 task 不再触发 pre_flight_burst
4. **alerting.js P0 限流持久化** 是另一个独立 PR（DB 记录 last_sent_at）
