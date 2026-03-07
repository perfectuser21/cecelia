---
name: platform-scraper
description: 管理所有媒体平台的数据采集配置和采集器
trigger: 当需要采集平台数据、修复采集器、或查看平台配置时
version: 3.2.0
updated: 2026-03-07
changelog:
  - 3.2.0: N8N 工作流映射完成，cron 配置文档化，抖音单元工作流补全
  - 3.1.0: 8平台全部可用，视频号/公众号采集器修复完成
  - 3.0.0: 全平台 v3 采集器完成，API+DOM 双重采集
  - 2.0.0: 完成所有平台采集器开发
  - 1.0.0: 初始版本
---

# Platform Scraper Skill

统一管理所有媒体平台的数据采集。

## 完成状态 (2026-01-30)

| 平台 | 数据量 | 采集器 | 端口 |
|------|--------|--------|------|
| 抖音 | 120 条 | `scraper-douyin-v3.js` | 19222 |
| 快手 | 125 条 | `scraper-kuaishou-v3.js` | 19223 |
| 小红书 | 80 条 | `scraper-xiaohongshu-v3.js` | 19224 |
| 今日头条 | 139 条 | `scraper-toutiao-v3.js` | 19225/19226 |
| 微博 | 151 条 | `scraper-weibo-v3.js` | 19227 |
| 知乎 | 66 条 | `scraper-zhihu-v3.js` | 19229 |
| 视频号 | 20 条 | `scraper-channels-v3.js` | 19228 |
| 公众号 | 20 条 | `scraper-wechat-v3.js` | 19230 |

**总计: 721 条, 8/8 平台可用**

## 使用方式

### 单平台采集
```bash
node /home/xx/scraper-douyin-v3.js
node /home/xx/scraper-kuaishou-v3.js
node /home/xx/scraper-xiaohongshu-v3.js
node /home/xx/scraper-toutiao-v3.js
node /home/xx/scraper-weibo-v3.js
node /home/xx/scraper-zhihu-v3.js
node /home/xx/scraper-channels-v3.js
node /home/xx/scraper-wechat-v3.js
```

### 批量采集
```bash
for p in douyin kuaishou xiaohongshu toutiao weibo zhihu channels wechat; do
  echo "采集 $p..."
  node /home/xx/scraper-${p}-v3.js
  sleep 5
done
```

## 数据存储

### JSON 文件
```
/home/xx/.platform-data/
├── douyin_*.json
├── kuaishou_*.json
├── xiaohongshu_*.json
├── toutiao_*.json
├── weibo_*.json
├── zhihu_*.json
├── channels_*.json
└── wechat_official_*.json
```

### 数据库
- **content_master**: 内容主表 (platform, title, publish_time)
- **content_snapshots**: 每日快照 (views, likes, comments)

## 浏览器端口
| 端口 | 平台 | Host |
|------|------|------|
| 19222 | 抖音 | 100.97.242.124 |
| 19223 | 快手 | 100.97.242.124 |
| 19224 | 小红书 | 100.97.242.124 |
| 19225 | 今日头条(大号) | 100.97.242.124 |
| 19226 | 今日头条(小号) | 100.97.242.124 |
| 19227 | 微博 | 100.97.242.124 |
| 19228 | 视频号 | 100.97.242.124 |
| 19229 | 知乎 | 100.97.242.124 |
| 19230 | 公众号 | 100.97.242.124 |

## 采集方法

| 平台 | 方法 |
|------|------|
| 抖音 | API fetch + DOM |
| 快手 | API 拦截 + 分页 |
| 小红书 | API 拦截 |
| 今日头条 | DOM 文本解析 |
| 微博 | DOM 文本解析 |
| 知乎 | API 分页 (offset) |
| 视频号 | API 拦截 (post_list) |
| 公众号 | DOM 文本解析 |

## N8N 自动化状态 (2026-03-07)

| 工作流 | N8N ID | 状态 |
|--------|--------|------|
| 调度器 (每日 21:00) | flow-data-collection | ✅ 运行中 |
| 抖音单元 | wxYIxt8paRz82lbW | ✅ 就绪 |
| 快手单元 | 8YC1JuIKo0aytgQz | ✅ 就绪 |
| 小红书单元 | I5It7tSAT7HadXYJ | ✅ 就绪 |
| 今日头条单元(大号) | SmJ3WIeVmR69l2dF | ✅ 就绪 |
| 今日头条单元(小号) | BLVEVjzdtjAPEblg | ✅ 就绪 |
| 微博单元 | VMS9m7rubG5zvyla | ✅ 就绪 |
| 视频号单元 | MnrpR0zzCaQvJ9yJ | ✅ 就绪 |
| 公众号单元 | HegJi0788KPG1Bqh | ✅ 就绪 |
| 知乎单元 | RDlBd8MRjDSICfRf | ✅ 就绪 |

## 下一步
- [x] 接入 N8N 定时调度
- [x] 每日自动采集（每天 21:00 自动触发）
- [ ] 数据趋势分析
