task_id: 1776e04e-4fbb-43f0-979e-df816dae547c
initiative_id: 2303a935-3082-41d9-895e-42551b1c5cc4
logical_task_id: ws3
sprint_dir: (inline DoD, harness-v2)

## 任务标题
新增 /api/brain/time/timezone 端点（支持 tz 参数）

## 任务描述
在 time 路由上新增 GET /api/brain/time/timezone 端点：支持可选 query 参数 tz（默认 Asia/Shanghai），返回 JSON { timezone, time }。非法 tz 返回 HTTP 400 而非 500。

## DoD
- [BEHAVIOR] 无参调用返回 HTTP 200 + timezone == 'Asia/Shanghai'
- [BEHAVIOR] 带合法 tz（如 America/New_York）返回 HTTP 200 + timezone 原样回显
- [BEHAVIOR] 带非法 tz（如 Not/AReal_Zone）返回 HTTP 400 + JSON 含可读 error 字段
- [BEHAVIOR] ws1、ws2 端点行为保持不变

## 目标文件
- packages/brain/src/routes/time.js

## 备注
ws2 端点在本 Task 开工时尚未合并到 main，无法直接编写 ws2 回归用例；
回归测试聚焦 ws1 /iso（已 merged）保证不变，ws3 自身新增端点不接触其它路由实现。
