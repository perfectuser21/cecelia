# PRD: Scraping 页面基础功能

## 功能描述

实现 Scraping 页面的基础功能，让用户可以查看和管理数据采集任务。

## 背景

当前 `/scraping` 路由存在但显示"功能开发中"。需要实现基础功能。

参考代码位置：`/home/xx/dev/zenithjoy-autopilot/apps/dashboard/frontend/src/pages/`

## 要求

1. 创建 `ScrapingPage.tsx` 组件
   - 显示爬虫任务列表（小红书、抖音、微博等）
   - 每个爬虫显示：名称、状态（运行中/停止）、最后执行时间、数据量
   - 支持手动触发执行

2. 创建 `scraping.api.ts`
   - `fetchScrapingTasks()` - 获取任务列表
   - `triggerScrapingTask(taskId)` - 触发任务执行

3. 调用 N8N webhook 触发爬虫
   - 小红书: `/webhook/xiaohongshu-scraper`
   - 抖音: `/webhook/douyin-scraper`
   - 等等

4. 确保 build 通过

## 验收标准

- [ ] ScrapingPage 显示爬虫任务列表
- [ ] 可以看到每个爬虫的状态
- [ ] `npm run build` 无错误

## 设计参考

使用与现有页面一致的卡片布局和颜色风格。
