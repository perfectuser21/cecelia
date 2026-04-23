task_id: 33b37ea3-4b3c-4797-b26e-f2d671e8acf5
initiative_id: 2303a935-3082-41d9-895e-42551b1c5cc4
logical_task_id: ws1
sprint_dir: (inline DoD, harness-v2)

## 任务标题
新增 /api/brain/time/iso 端点与路由骨架

## 任务描述
建立 Brain 下新的 time 路由模块，挂载到主 HTTP 入口，实现 GET /api/brain/time/iso：返回 JSON { iso: <ISO8601 字符串> }。本 Task 只覆盖 iso 一个端点，作为后续 unix/timezone 扩展的基础骨架。

## DoD
- [BEHAVIOR] Brain 启动后 curl localhost:5221/api/brain/time/iso 返回 HTTP 200 + JSON，iso 字段可被标准 ISO8601 解析
- [BEHAVIOR] iso 字段对应的时刻与请求时的真实系统时间差不超过 5 秒
- [ARTIFACT] 新增文件 packages/brain/src/routes/time.js 存在
- [ARTIFACT] packages/brain/src/server.js 中出现对 time 路由的挂载语句

## 目标文件
- packages/brain/src/routes/time.js
- packages/brain/src/server.js

## 备注
DoD 列出的 `packages/brain/src/server.js` 在当前仓库实际位于 `packages/brain/server.js`
（仓库内不存在 `src/server.js` 文件）。为满足 [BEHAVIOR] DoD（端口 5221 实跑），挂载语句加在
真实入口 `packages/brain/server.js` 中；这是合同未覆盖的真实路径偏差，仅记录不再扩散。
