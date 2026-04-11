# Learning: BRAIN_QUIET_MODE 阻断 Self-Drive 健康循环

## 任务
Auto-Fix: PROBE_FAIL_SELF_DRIVE_HEALTH

## 根本原因

`launchd` plist 中设置了 `BRAIN_QUIET_MODE=true`（永久存在），
而 `server.js` 将 Self-Drive 引擎启动放在 `if (BRAIN_QUIET_MODE !== 'true')` 条件块内。

结果：Brain 每次重启后 Self-Drive 从未启动，24h 内零事件，探针失败。

### 关键证据
- Brain 日志：`Self-Drive Engine SKIPPED (BRAIN_QUIET_MODE=true)` 出现 7 次
- 数据库：最后一次 `self_drive` 事件距探针检查超 24h
- plist：`/Library/LaunchDaemons/com.cecelia.brain.plist` 含 `<key>BRAIN_QUIET_MODE</key><string>true</string>`

### 下次预防

- [ ] `BRAIN_QUIET_MODE` 的作用域应明确：只抑制 LLM 生成内容（丘脑/沉思/叙述），不抑制健康监控模块
- [ ] Self-Drive、Capability Probe、Capability Scanner 是"核心健康循环"，不能被任何环境变量全局禁用
- [ ] 当新增 quiet-mode 判断时，审查是否影响了健康探针/自驱引擎类模块
- [ ] launchd plist 中的永久环境变量要记录到 decisions 表，避免被遗忘后成为隐藏障碍
