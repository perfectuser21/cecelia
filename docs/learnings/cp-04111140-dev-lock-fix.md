## dev-lock 丢失导致 stop hook fail-open（2026-04-11）

### 根本原因
两个独立缺陷叠加：
1. `stop-dev.sh`：无 dev-lock 直接 exit 0（fail-open），dev-lock 丢失时 Claude 可在任意阶段退出
2. `00-worktree-auto.md`：重建 dev-lock 用 `cp dev-mode`，dev-mode 无 tty/session_id，`_session_matches` 永远返回 false，等于重建无效

### 下次预防
- [ ] dev-lock 重建逻辑必须生成 session 字段（tty + session_id），不能 cp dev-mode
- [ ] stop hook 任何新增 exit 0 路径都必须有测试断言覆盖
- [ ] fail-open vs fail-closed：找不到会话 ≠ 没有活跃会话，要扫 dev-mode 二次确认
