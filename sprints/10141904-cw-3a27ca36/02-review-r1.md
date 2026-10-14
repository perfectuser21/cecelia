---
task_id: 3a27ca36-7be9-4efc-a27f-18361dae6557
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 8
可验证: 7
场景覆盖: 7
回归风险: 8
可执行: 8

### R-1
针对: S-1, S-2, Q-3, I-2
严重度: 重要
场景: 运维人员按安装器支持的 `CODING_WF_USER_HOME=/Volumes/runner-home` 安装后，照手册到 `/Users/<运行用户>/Library/Logs/coding-workflow-runner.log` 查故障，却找不到实际写入 `/Volumes/runner-home/Library/Logs/` 的主日志。
依据: `packages/brain/scripts/coding-workflow/runner/install.sh` 用 `CODING_WF_USER_HOME` 覆盖 `USER_HOME`，并从 `USER_HOME` 生成 `LOG_FILE` 写进 plist；S-1 要求操作者核对实际 home，S-2 却固定写 `/Users/<运行用户>/Library/Logs/`。Q-3 只检查该命令文本，未覆盖 home 被覆盖时的日志定位。
说明: S-2 的日志查询命令应从安装时的 `CODING_WF_USER_HOME` 或已安装 plist 的 `StandardOutPath` 推导，不把 `/Users/<运行用户>` 当唯一位置；Q-3 增加自定义 home 的文档对照案例。
