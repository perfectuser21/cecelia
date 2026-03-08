---
name: janitor
version: 1.0.0
description: |
  小扫（Janitor）- 每日磁盘清扫员。
  自动清理 Docker 容器日志、PM2 日志、/tmp 垃圾、旧缓存。
  每天凌晨 4:00 由 cron 自动运行，无需人工干预。
  磁盘超 70% 时自动告警到 Cecelia Brain。
created: 2026-02-24
changelog:
  - 1.0.0: 初始版本，覆盖7类清扫任务
---

# /janitor - 小扫（磁盘清扫员）

**系统维护角色**，专门负责每日磁盘卫生。

## 定位

```
外部专家（自动化）：
├── 🍂 秋米 (/autumnrice) - OKR 拆解
├── 💻 Caramel (/dev)     - 写代码
└── 🧹 小扫 (/janitor)   - 每日清扫  ← 这是我
```

**关键**：小扫是纯脚本员工，不用 LLM，每天定时自动执行。

## 触发方式

| 方式 | 命令 |
|------|------|
| 手动触发 | `janitor.sh` |
| 自动调度 | 每天凌晨 4:00 cron 自动 |
| 查看日志 | `cat /tmp/janitor-$(date +%Y%m%d).log` |

## 清扫清单（8项）

| # | 清扫目标 | 频率 | 大小范围 |
|---|---------|------|---------|
| 1 | Docker 容器日志（>100M 截断） | 每日 | 几百MB/次 |
| 2 | Docker build cache（>7天） | 每日 | 几十~几百MB |
| 3 | Docker 已停止容器 | 每日 | 少量 |
| 4 | PM2 日志 | 每日 | ~50MB |
| 5 | Cecelia prompts（>7天） | 每日 | ~30MB |
| 6 | /tmp 旧随机目录（>1天） | 每日 | ~400MB/次 |
| 7 | VSCode 旧 VSIX 安装包缓存 | 每日 | ~120MB |
| 8 | Git 孤儿分支（cp-*/worktree-*） | 每日 | N/A（分支清理） |

## 告警机制

磁盘使用率超过 **70%** 时，自动向 Cecelia Brain 提交 P0 告警任务。

## 脚本位置

```
/home/xx/bin/janitor.sh
```

## Cron 配置

```cron
0 4 * * * /home/xx/bin/janitor.sh >> /tmp/janitor-cron.log 2>&1
```

## 手动触发

```bash
# 立即执行一次
janitor.sh

# 查看今天的日志
cat /tmp/janitor-$(date +%Y%m%d).log
```

## 需要 sudo 的项（小扫做不了，需人工）

```bash
# Snap 旧版本（~500M）
sudo snap remove chromium --revision=3361
sudo snap remove core20 --revision=2686
# ... 等（几个月更新一次即可）

# 老系统日志
sudo rm /var/log/auth.log.1.20250827
sudo journalctl --vacuum-size=50M
```
