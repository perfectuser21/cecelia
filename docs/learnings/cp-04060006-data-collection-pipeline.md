# Learning: 数据采集缺失链路根因与修复

## 任务
[数据闭环] 全平台数据采集端点完整化 — 补齐缺失链路

## 根本原因

### 1. 多机数据孤岛
CN Mac mini 爬虫（scraper-douyin-v3.js 等）只写本地 DB (`content_master` / `content_snapshots`)，不向 US Mac mini 的 Brain API 推送。US 机器上的 `social_media_raw` DB 存在但为空，是一个架构意图未落地的残留。

### 2. content_analytics 始终为空
`POST /api/brain/analytics/scrape-result` 端点存在（PR #1945），但没有任何调用方。Brain 内部的 `post-publish-data-collector.js` 只写占位符 (0,0,0,0)，实际数据从未流入。

### 3. 无覆盖感知端点
选题引擎和周报生成器只能被动等待数据，没有主动查询"哪些平台缺数据"的能力。

## 修复方案

本 PR 建立了数据管道的 Brain 侧基础设施：

```
social_media_raw DB ──→ social-media-sync.js ──→ content_analytics
                                                       ↑
POST /api/brain/analytics/scrape-result ───────────────┘（已有）
```

新增：
- `social-media-sync.js` — 幂等同步模块，每 tick 自动运行
- `GET /api/brain/analytics/collection-coverage` — 采集覆盖状态（8平台×是否有数据）
- `POST /api/brain/analytics/social-media-sync` — 手动触发同步

## 下次预防

- [ ] 爬虫脚本跑完后必须 POST 到 Brain API（在 CN Mac mini 脚本里加 `reportToBrain()` 步骤）
- [ ] 新建采集管道时，同步检查：US 机器 `social_media_raw` DB 是否已有数据
- [ ] `content_analytics` 长期为空时，告警应触发（Brain immune system）
