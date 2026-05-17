# Social Trending API

## 功能

`GET /api/brain/social/trending` — 查询 TimescaleDB 中各平台社媒热点数据。

## 用途

供 Brain 内容 pipeline 读取 HK VPS 采集器抓取的热点数据，实现社媒数据驱动的内容选题。

## 参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| platform | string | - | 过滤平台（douyin/xiaohongshu/weibo 等） |
| limit | number | 50 | 返回条数上限 |
| days | number | 7 | 时间范围（最近 N 天） |

## 数据源

TimescaleDB `v_all_platforms` 视图，连接参数由 `TIMESCALE_HOST/TIMESCALE_DB/TIMESCALE_USER/TIMESCALE_PASSWORD` 环境变量控制。

## 降级行为

TimescaleDB 不可达时返回空数组 `[]` + HTTP 200，不阻塞 Brain 其他功能。
