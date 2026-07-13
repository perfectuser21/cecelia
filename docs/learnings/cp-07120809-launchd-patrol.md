## launchd 服务静默禁用系统性缺口——launchd-patrol 哨兵（2026-07-12）

### 根本原因
launchd 服务失效有两种彼此独立的形态，此前都没有任何"预期 vs 实际"核对机制：
1. **持久 disabled 标记**：launchctl 把服务写进 disabled 表后跨重启生效（07-10 com.cecelia.bridge，thalamus LLM 链路全断，PR #3768）。
2. **gui/501 域不存在**：本机无 Aqua 登录会话（sudo `launchctl print gui/501` 恒 125），`~/Library/LaunchAgents` 下全部 plist 永不加载——zenithjoy-api 及其两个 keepalive 整体失效，5200 宕近 3 天无告警（07-08~07-11）。
用 launchd 自身（再加一个 watchdog daemon）守 launchd 是循环依赖；守卫必须放在存活性独立的载体上（Brain docker unless-stopped）。

### 下次预防
- [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST_LISTEN_PORTS）
- [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=administrator`（bridge 先例）
- [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a）
- [ ] 部署后 proven-to-fire：临时 disable 低风险服务（pf-firewall）验证 Bark 真响后立即恢复
