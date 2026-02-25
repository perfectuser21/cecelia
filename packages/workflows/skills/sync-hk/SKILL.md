---
name: sync-hk
description: |
  同步美国 → 香港。
  触发词：/sync-hk、同步到香港、sync to hk
---

# /sync-hk - 美国 → 香港同步

**全部用 rsync，通过 Tailscale 内网同步。**

## 用法

```bash
sync-to-hk.sh all        # 同步全部（默认）
sync-to-hk.sh skills     # 只同步 skills
sync-to-hk.sh workflows  # 只同步 cecelia-workflows
sync-to-hk.sh platform   # 只同步 perfect21-platform
```

## 自动同步

已设置 cron 每小时自动同步：
```
0 * * * * /home/xx/bin/sync-to-hk.sh all >> /tmp/sync-to-hk.log 2>&1
```

## 同步内容

| 内容 | 美国路径 | 香港路径 |
|------|---------|---------|
| Skills | ~/.claude/skills/ | ~/.claude/skills/ |
| Workflows | ~/dev/cecelia-workflows/ | ~/dev/cecelia-workflows/ |
| Platform | ~/dev/perfect21-platform/ | ~/dev/perfect21-platform/ |

## 日志

```bash
tail -f /tmp/sync-to-hk.log
```
