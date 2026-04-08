# Learning: 数据采集管道 — CN Mac mini → Brain 数据推送

## 根本原因

`social-media-sync.js` 设计为连接本机 `social_media_raw` DB，但 Brain 运行在 US Mac mini，
CN Mac mini 的采集数据无法自动同步到 Brain 的 `content_analytics` 表，导致数据永远为 0。

## 下次预防

- [ ] 跨机器数据同步需要明确推送方向：CN → US
- [ ] 新采集脚本必须有 `BRAIN_API` 环境变量配置，指向 Brain API 地址
- [ ] 每次 DB 表 0 行时，先检查跨机器连接方向，再查逻辑

## 修复方案

新增 `packages/brain/scripts/push-scraper-data.js`：
在 CN Mac mini 上运行，读取 `social_media_raw` DB，POST 到 `38.23.47.81:5221/api/brain/analytics/scrape-result`。
新增 `GET /api/brain/analytics/pipeline-status` 端点供 Dashboard 和监控感知管道健康。
