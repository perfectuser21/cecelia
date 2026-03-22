# Learning: 系统韧性加固 — 内存压力背压 + 自启动修复

## 根本原因

2026-03-21 凌晨 kernel panic（AMCC iBoot async abort）根因链：

1. **多个并发 dev 任务** → 每个触发 Stage 2 本地 vitest 全量跑
2. **多进程 vitest 叠加** → 系统内存耗尽（availPages=0）
3. **Jetsam 杀 node 进程** → kernel panic（AMCC 硬件内存控制器错误）
4. **机器重启** → PG17 + Brain 均未自动拉起：
   - `com.cecelia.brain` LaunchDaemon 处于 **disabled** 状态
   - PG17 只有 `~/Library/LaunchAgents`（用户级），SSH 登录不触发

## 修复

- `slot-allocator.js`：新增内存压力维度，可用内存 < 600MB 时触发背压停止派发
- `scripts/setup-autostart.sh`：一键修复 Brain + PG17 为系统级 LaunchDaemon
- `02-code.md`（skill）：Stage 2 改用 `vitest run --related` 替代全量 `npm test`

## 下次预防

- [ ] 机器重启后验证：`sudo launchctl list | grep brain` 和 `pg_ctl status`
- [ ] OOM 发生后检查：Brain 背压日志是否有 `memory=XXX MB < 600MB` 输出
- [ ] `.prd.md` 等临时文件不应提交到 git（已加 `.gitignore`）
- [ ] 新 dev 任务派发前检查可用内存：`vm_stat | grep "Pages free"`

## 额外发现

- `.prd.md` 被 PR #1310 意外提交，导致 `check-dod-mapping.cjs` 追溯检查用旧 PRD 验证新 DoD → engine 测试失败。已在本 PR 删除。
- `branch-protect.sh` 检查 `prd_id` 字段但 Brain API 返回 `prd_content`（字段名 mismatch），需后续修复 hook。
- CI 时序陷阱：若 learning 文件在 PR 创建后才提交，旧 merge commit 不含该文件，CI 会报"未找到 Learning 文件"。解决：创建新 PR 触发新 merge commit。
