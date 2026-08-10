# DoD — preview-reaper 停止误杀 OrbStack vmgr

task_id: ec6ad029-c7ce-4fb4-aab1-683929fbf73c
gear: hotfix (P0)
scope: 只改 `scripts/preview-reaper.sh` 的杀进程逻辑及其单测

## 根因

`scripts/preview-reaper.sh` 旧逻辑用 `lsof -ti :$PORT` 找端口持有者并 `kill -9`。
OrbStack vmgr 负责容器端口转发、正是预览端口（5300-5302）的持有者，于是每次回收
把 OrbStack VM 管理器 SIGKILL 掉，引发全机 docker 中断、连锁打死所有 harness run。
正确 PID 早已记录在 `/tmp/preview-${pr}.pid`（`preview-env-start.sh:290` 写入），旧逻辑
却把它删掉、改用 lsof 猜端口持有者。

## [ARTIFACT] 交付物

- [x] `scripts/preview-reaper.sh` 杀进程逻辑改为读 `/tmp/preview-${pr}.pid`，不再 `lsof -ti :$PORT`
- [x] 杀之前校验目标进程 cmdline 含本 PR 标识（`BRAIN_PREVIEW_PR=<pr>` 或 worktree 路径 `preview-<pr>`），不过不杀
- [x] 基础设施红线：命中 OrbStack / docker / 容器运行时的进程一律跳过并告警，绝不 kill
- [x] pid 文件缺失降级：不回落到杀端口持有者，仅记日志跳过
- [x] 其余回收动作（DB 置 inactive、npm cache 清理、临时文件清理、worktree 删除）行为不变
- [x] `scripts/__tests__/preview-reaper.test.sh` 新增覆盖以上 4 条 + 回归红线的单测

## [BEHAVIOR] 验收断言（真跑）

- [x] [BEHAVIOR] reaper-kill-suite | 全套 reaper 单测（含新增杀进程逻辑用例）全绿 | Test: manual:cd "$(git rev-parse --show-toplevel)" && bash scripts/__tests__/preview-reaper.test.sh
- [x] [BEHAVIOR] no-lsof-kill | 脚本不再用 `lsof -ti :$PORT` 作为杀进程依据 | Test: manual:cd "$(git rev-parse --show-toplevel)" && ! grep -qE 'lsof -ti :"?\$PORT' scripts/preview-reaper.sh
- [x] [BEHAVIOR] infra-redline | 脚本含 OrbStack/docker 基础设施红线跳过分支 | Test: manual:cd "$(git rev-parse --show-toplevel)" && grep -qiE 'orbstack|vmgr|dockerd|docker-proxy|containerd' scripts/preview-reaper.sh
