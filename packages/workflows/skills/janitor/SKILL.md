---
name: janitor
version: 2.0.0
description: |
  小扫（Janitor）- 系统清扫员（Mac mini 版）。
  两种模式：daily（磁盘清理，每天 4am）+ frequent（僵尸进程清理，每 30 分钟）。
  纯 bash 脚本，无需 LLM，cron 自动运行。
  磁盘超 70% 时自动告警到 Cecelia Brain。
created: 2026-02-24
updated: 2026-03-08
changelog:
  - 2.0.0: 从 VPS 版重写为 Mac mini v2.0（9 项清扫 + frequent 模式）
  - 1.0.0: 初始版本（VPS Docker/PM2 清理）
---

# /janitor - 小扫（系统清扫员）

**系统维护角色**，负责磁盘卫生和僵尸进程清理。

## 定位

```
外部专家（自动化）：
├── 🍂 秋米 (/autumnrice) - OKR 拆解
├── 💻 Caramel (/dev)     - 写代码
└── 🧹 小扫 (/janitor)   - 系统清扫  ← 这是我
```

**关键**：小扫是纯脚本员工，不用 LLM，cron 自动执行。确定性任务不需要大模型。

## 两种运行模式

| 模式 | 频率 | 职责 |
|------|------|------|
| `daily` | 每天 4:00 AM | 磁盘清理（9 项任务） |
| `frequent` | 每 30 分钟 | 僵尸进程清理（vitest/jest/孤儿 node） |

## 触发方式

| 方式 | 命令 |
|------|------|
| 手动 daily | `janitor.sh` 或 `janitor.sh --mode daily` |
| 手动 frequent | `janitor.sh --mode frequent` |
| 自动调度 | cron（见下方配置） |
| 查看日志 | `cat /tmp/janitor-$(date +%Y%m%d).log` |

## Daily 清扫清单（9 项）

| # | 清扫目标 | 条件 | 预估大小 |
|---|---------|------|---------|
| 1 | Brain/Bridge LaunchDaemon 日志截断 | >10MB 保留最后 1000 行 | 几十~几百 MB |
| 2 | /tmp/cecelia-*.log 旧运行日志 | >3 天删除 | ~100 MB |
| 3 | Claude JSONL 会话记录 | >7 天删除 | ~1 GB（最大增长源） |
| 4 | npm cache | 全量清理 | ~1.4 GB |
| 5 | Homebrew cache | >7 天清理 | ~250 MB |
| 6 | /tmp 旧随机临时目录 | >1 天删除 | ~400 MB |
| 7 | .prd/.dod/.dev-mode 残留文件 | >3 天删除 | 少量 |
| 8 | Git 孤儿分支（cp-*/worktree-*） | 调用 branch-gc.sh | N/A（分支清理） |
| 9 | 残留 worktree | >24h 且无 open PR | N/A（目录清理） |

## Frequent 清理内容

| 目标 | 条件 | 说明 |
|------|------|------|
| vitest/jest 僵尸进程 | 运行 >2 小时 | 先 SIGTERM，1s 后 SIGKILL |
| 孤儿 node 进程 | 运行 >2 小时 + PPID=1 | 排除 brain/server/n8n/claude/vscode |

## 告警机制

磁盘使用率超过 **70%** 时，自动向 Cecelia Brain 提交 P0 告警任务。

## 脚本位置

```
packages/workflows/skills/janitor/janitor.sh   # git 管理的 SSOT
~/bin/janitor.sh -> packages/workflows/skills/janitor/janitor.sh  # 软链接
```

脚本纳入 git 管理（v3.0 起），`~/bin/janitor.sh` 是指向 repo 文件的软链接，由 cron 直接调用。

依赖脚本（git 中）：
```
packages/engine/skills/dev/scripts/branch-gc.sh   # 第 8 步调用
```

## Cron 配置

```cron
# Daily: 每天凌晨 4:00 磁盘清理
0 4 * * * /Users/administrator/bin/janitor.sh --mode daily >> /tmp/janitor-cron.log 2>&1

# Frequent: 每 15 分钟清理僵尸进程（*/15）
*/15 * * * * /Users/administrator/bin/janitor.sh --mode frequent >> /tmp/janitor-cron.log 2>&1
```

## 手动触发

```bash
# 立即执行 daily 清理
janitor.sh

# 立即执行僵尸进程清理
janitor.sh --mode frequent

# 查看今天的日志
cat /tmp/janitor-$(date +%Y%m%d).log
```
