# PRD: AI 员工实时统计 API

## 功能描述

实现 AI 员工页面的实时统计功能，连接后端 n8n-live-status API。

## 背景

当前 `ai-employees.api.ts` 中的 `fetchAiEmployeesWithStats()` 返回静态配置数据，需要改为调用实时 API。

参考代码位置：`/home/xx/dev/zenithjoy-autopilot/apps/dashboard/frontend/src/api/ai-employees.api.ts:157`

## 要求

1. 创建后端 API endpoint `/api/n8n-live-status`
   - 调用 N8N API 获取工作流执行状态
   - 返回格式：`{ workflows: [{ id, name, lastExecution, status, executionCount }] }`

2. 修改 `ai-employees.api.ts`
   - 取消注释实时 API 调用逻辑
   - 添加错误处理和 fallback

3. 确保 build 通过

## 验收标准

- [ ] 后端 API `/api/n8n-live-status` 可用
- [ ] AI 员工页面显示实时任务统计
- [ ] `npm run build` 无错误

## 技术约束

- N8N API URL: http://localhost:5679
- N8N API Key: 从环境变量 `N8N_LOCAL_API_KEY` 读取
