---
id: media-scraping
version: 1.0.0
created: 2026-01-28
updated: 2026-01-28
changelog:
  - 1.0.0: 初始版本，记录各平台抓取策略
---

# Media Scraping Skill

## 概述

自媒体平台数据采集系统。支持 6 大平台自动化数据采集。

## 平台配置

### 1. 抖音 (douyin)

**连接信息**：
- Chrome CDP: `100.97.242.124:19222`
- URL: `https://creator.douyin.com/creator-micro/content/manage`

**页面特征**：
- 分页显示，默认显示约 10-15 条
- 显示"共 N 个作品"
- 滚动无效，需点击分页按钮

**数据字段**（视频）：
- 标题、发布时间、播放量、点赞数、评论数、分享数、收藏数
- 平均播放时长、完播率、5秒完播率

**数据字段**（图文）：
- 标题、发布时间、观看数、点赞数、评论数、分享数
- 翻页率、封面点击率

**状态**: ✅ 可抓取（当前页 10-15 条）

---

### 2. 快手 (kuaishou)

**连接信息**：
- Chrome CDP: `100.97.242.124:19223`
- URL: `https://cp.kuaishou.com/article/manage/video`

**数据字段**：
- 标题、发布时间、播放量、点赞数、评论数、分享数、收藏数
- 完播率、5秒完播率、平均播放时长

**状态**: ✅ 可抓取（当前页 20-30 条）

---

### 3. 小红书 (xiaohongshu)

**连接信息**：
- Chrome CDP: `100.97.242.124:19224`
- URL: `https://creator.xiaohongshu.com/publish` ❌ 数据太少

**问题**：当前 URL 只有 76 字符，需要深度解析找到正确页面

**备用 URL**：
- `https://creator.xiaohongshu.com/creator/post`
- `https://creator.xiaohongshu.com/creator/home`

**数据字段**：
- 标题、发布时间、浏览量/观看量、点赞数、收藏数、评论数、分享数
- 主页访问量

**状态**: ❌ 需修复（深度解析）

---

### 4. 今日头条 (toutiao)

**连接信息**：
- Chrome CDP: `100.97.242.124:19225` (大号)
- Chrome CDP: `100.97.242.124:19226` (小号)
- URL: `https://mp.toutiao.com/profile_v4/graphic/articles`

**数据字段**：
- 标题、发布时间、阅读量、评论数
- 点击率、跳出率

**状态**: ✅ 可抓取（当前页）

---

### 5. 微博 (weibo)

**连接信息**：
- Chrome CDP: `100.97.242.124:19227`
- URL: `https://weibo.com/at/weibo` ❌ Desktop 失败

**问题**：Desktop 版本只有 54 字符

**解决方案**: ⚠️ **需要切换到 Mobile 版本**

**数据字段**：
- 正文、发布时间、转发数、评论数、点赞数

**状态**: ❌ 需修复（使用 Mobile）

---

### 6. 视频号 (channels)

**连接信息**：
- Chrome CDP: `100.97.242.124:19228`
- URL: `https://channels.weixin.qq.com/platform/post/list`

**数据字段**：
- 标题、发布时间、播放量、点赞数、评论数、分享数、收藏数

**状态**: ✅ 可抓取（当前页）

---

## 技术架构

### 数据流

```
Chrome (远程) → CDP → Scraper → raw_scraping_data → Parser → content_items
```

### 爬虫版本

**当前**: `platform-scraper-v9-scroll.js`
**位置**: `/home/xx/platform-scraper-v9-scroll.js`

**功能**：
- 连接远程 Chrome (CDP)
- 滚动加载（大部分平台无效）
- 保存到 raw_scraping_data

**限制**：
- 只抓当前页（10-30 条）
- 无分页翻页
- 无 30 天完整历史

---

## 使用方法

### 抓取单个平台

```bash
node /home/xx/platform-scraper-v9-scroll.js douyin
```

### 批量抓取

```bash
/home/xx/scrape-all-platforms.sh
```

---

## 待修复

1. ❌ 小红书 - 深度解析找正确页面
2. ❌ 微博 - 切换 Mobile 版本
3. ⏳ 分页翻页 - 抓取完整 30 天
4. ⏳ 数据解析器 - raw_text → content_items
5. ⏳ 定时任务 - 每天自动运行

---

**维护**: 每次修改爬虫必须更新此文档
**位置**: `~/.claude/skills/media-scraping/SKILL.md`
