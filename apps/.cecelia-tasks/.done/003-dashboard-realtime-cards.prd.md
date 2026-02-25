# PRD: Dashboard 实时数据卡片

## 功能描述

增强 Dashboard 页面，添加实时数据展示卡片。

## 背景

Dashboard 需要展示关键业务指标，让用户一目了然。

参考代码位置：`/home/xx/dev/zenithjoy-autopilot/apps/dashboard/frontend/src/pages/Dashboard.tsx`

## 要求

1. 添加统计卡片区域
   - 今日发布数
   - 待处理任务
   - 活跃账号数
   - AI 员工执行次数

2. 每张卡片显示
   - 数值
   - 较昨日变化（+/-）
   - 图标

3. 调用现有 API 获取数据
   - 使用 `metrics.api.ts` 或创建新的 dashboard API

4. 确保 build 通过

## 验收标准

- [ ] Dashboard 显示 4 个统计卡片
- [ ] 数据从 API 获取
- [ ] `npm run build` 无错误

## 设计参考

卡片使用玻璃拟态效果，与整体设计风格一致。
