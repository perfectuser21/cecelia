task_id: a930d4dd-15d6-41f9-9cbf-f4bdc6d8a75f
initiative_id: bb245cb4-f6c4-44d1-9f93-cecefb0054b3
logical_task_id: ws1
contract_branch: (not injected by dispatch — DoD taken verbatim from task prompt)
sprint_dir: (not injected by dispatch)

## 任务标题
新增 health 路由模块 (src/routes/health.js)

## 任务描述
创建 packages/brain/src/routes/health.js，导出一个 Express Router；在 '/' 上实现 GET handler，返回 JSON 对象且仅含三字段：status（固定字符串 'ok'）、uptime_seconds（进程启动以来的秒数）、version（取自 packages/brain/package.json 的 version 字段）。handler 不得访问数据库、tick 状态、外部服务。模块必须是纯函数式、可独立被测试文件 import。

## DoD
- [ARTIFACT] 文件 packages/brain/src/routes/health.js 存在
- [ARTIFACT] 该文件默认导出或命名导出一个 Express Router 实例
- [BEHAVIOR] 通过 supertest 或等价方式调用 Router 的 GET /，响应 body 仅含且恰好含 status/uptime_seconds/version 三键
- [BEHAVIOR] 响应 status === 'ok'；uptime_seconds 为非负 number；version 等于 package.json.version
- [BEHAVIOR] 不触发 db.js / pg pool 的任何 import-time 或请求期连接（可通过 jest/vitest mock 断言未被调用）

## 目标文件
- packages/brain/src/routes/health.js
