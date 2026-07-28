# Handoff：feat(janitor): audiomxd 死循环 CPU 兜底清理

- task_id: unknown（对话内临时排查延伸出的小改动，未走 Brain task 注册）
- initiative_id: N/A
- journey_id: N/A
- verdict: PASS
- created_at: 2026-07-28T10:15:00.000Z

## 完成了什么
- 承接同一 session 早前"机器变卡"排查：确认关闭蓝牙未能根治 `audiomxd` 卡在 `com.apple.mediaexperience.btroutingrequestqueue` 死循环（两次独立采样调用栈完全一致），真实触发源未知（decisions `f418f03c` 已补充修正）
- 给 `zenithjoy-skills` 仓库的 `janitor/janitor.sh` frequent 模式（每15分钟）加止损 watchdog：`pgrep -x audiomxd` 精确匹配 + CPU>=80% 时 `sudo -n kill -9`，launchd 自动拉起干净实例
- 走完整 /dev 路径B流程：PrepPRD → 决策写库(`96b8d893`) → engine-worktree → brainstorming(设计文档) → writing-plans → subagent-driven-development（1个implementer+spec审查+2轮代码质量审查+最终全量审查，全部通过/APPROVED）→ finishing(Option2 push+PR) → PR [zenithjoy-skills#168](https://github.com/perfectuser21/zenithjoy-skills/pull/168) 已 squash-merge
- 审查过程中现场实测确认本机 audiomxd 当时确实又有一个实例卡在 100% CPU，佐证问题真实存在（非臆测）

## 没完成什么
- 真实触发源仍未查明（怀疑反复创建 AVAudioSession 的某进程，或 CFNotificationCenter 观察者注册表因 57 天未重启而膨胀导致查找变慢）——本次只做了止损 watchdog，不是根治
- 未在 xian-m4/xian-m1 上部署这段 janitor 改动（那两台机器的蓝牙已关闭，但 janitor.sh 的这次改动是否也要同步过去未讨论）
- 代码审查里提到的"观测性缺口"（kill 失败时无日志）和"无冷却机制"两项建议未采纳（判定为锦上添花，非阻塞项）

## 下一步建议
- 观察 us-mac 的 janitor 日志（`/tmp/janitor-$(date +%Y%m%d).log`），确认 watchdog 实际生效次数，倒推 audiomxd 真实复发频率
- 若确认 xian-m4/xian-m1 也需要同样的 janitor watchdog，另起一次小改动同步过去
- 有精力时可以边跑 `log stream` 边等 audiomxd 复发，抓真正的触发调用方，把 decisions `f418f03c` 从"未知触发源"升级为确定根因

## 数据源（下一个大脑要加载的）
- decisions `f418f03c`（无人值守 Mac mini 蓝牙策略，含 audiomxd 复发的修正说明）
- decisions `96b8d893`（janitor watchdog 小改动决策）
- zenithjoy-skills PR #168（合并的 commit 历史含完整审查过程）

## 关键决策引用
- `f418f03c` — 蓝牙策略（已修正为"未完全解决"）
- `96b8d893` — janitor watchdog 小改动

## 产物指针
- https://github.com/perfectuser21/zenithjoy-skills/pull/168
- sprint_dir: N/A
- branch: cp-0728175445-janitor-audiomxd-watchdog（已合并，worktree 已清理）
