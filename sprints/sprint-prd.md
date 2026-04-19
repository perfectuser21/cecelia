# Sprint PRD — GET /api/brain/ping 端到端冒烟端点

## OKR 对齐

- **对应 KR**：KR-Pipeline-Smoke（Generator 容器内 git push 真实产出 PR 的可验证性）
- **当前进度**：未知（Brain API 不可达）
- **本次推进预期**：完成后可通过一次最小闭环验证 Generator → git push → PR 产出链路，推进至"至少 1 次真实 PR 产出"里程碑
- **说明**：Brain API `localhost:5221/api/brain/context` 不可达（curl exit 7），KR 编号与当前进度均为推断，见假设列表。

## 背景

当前怀疑 Generator 在 Docker 容器内的 git push 链路可能返回 null（即未真正产出 PR）。需要一个功能体量极小、无外部依赖、输出结果可人工肉眼验证的端点，作为端到端流水线冒烟用例，排除"复杂任务失败掩盖管道问题"的干扰因素。

## 目标

在后端新增一个无副作用的只读端点 `GET /api/brain/ping`，返回固定结构 `{pong: true, timestamp: <ISO 8601 字符串>}`，以便作为 Generator → Git push → PR 产出全链路的最小验证锚点。

## User Stories

**US-001**（P0）: 作为 Harness 维护者，我希望调用 `GET /api/brain/ping` 立即得到 `{pong: true, timestamp: ...}`，以便确认后端进程存活且路由注册正常。

**US-002**（P0）: 作为 Harness 维护者，我希望这个端点随 PR 一起被真实 push 到远端并产生 PR 链接，以便验证 Generator 容器内的 git push 产物不为 null。

## 验收场景（Given-When-Then）

**场景 1**（关联 US-001）: 正常调用返回成功
- **Given** 后端服务已启动并监听 5221 端口
- **When** 客户端发起 `GET /api/brain/ping`
- **Then** 响应状态码为 200，响应体为 JSON 格式，包含字段 `pong`（布尔值 `true`）和 `timestamp`（ISO 8601 字符串）

**场景 2**（关联 US-001）: 每次调用 timestamp 动态刷新
- **Given** 后端服务已启动
- **When** 客户端在两个不同时间点分别调用 `GET /api/brain/ping`
- **Then** 两次响应中的 `timestamp` 字段不相同，且均为合法 ISO 8601 格式

**场景 3**（关联 US-002）: 端点可被 PR 引入
- **Given** Generator 接收到本 PRD 对应的合同
- **When** Generator 执行 git push 并开 PR
- **Then** PR 链接非 null，PR 中包含新增的 `/api/brain/ping` 路由代码

## 功能需求

- **FR-001**: 新增 HTTP 路由 `GET /api/brain/ping`
- **FR-002**: 响应体为 JSON 对象，仅包含两个字段：`pong`（固定为布尔 `true`）和 `timestamp`（服务器当前时间的 ISO 8601 字符串）
- **FR-003**: 端点无需鉴权、无需请求参数、无副作用（不写库、不发外部请求）
- **FR-004**: 端点注册后，`GET /api/brain/ping` 应能通过 curl 成功访问，返回 HTTP 200

## 成功标准

- **SC-001**: `curl -s http://localhost:5221/api/brain/ping` 返回的 JSON 可被 `jq -e '.pong == true'` 断言通过
- **SC-002**: 响应 JSON 中 `timestamp` 字段可被 `date -d "$TIMESTAMP"` 或等效 ISO 8601 解析器成功解析
- **SC-003**: 响应 HTTP 状态码为 200
- **SC-004**: 本任务对应的 PR 成功合入（非 null PR 链接）— 作为 Generator git push 链路修复的验证信号

## 假设

- [ASSUMPTION: Brain API 端点 `localhost:5221/api/brain/context` 当前不可达，OKR/KR 编号和当前进度为推断值，需 Proposer/用户后续确认]
- [ASSUMPTION: 后端框架为 Flask（依据 `server.py` 中的 `from flask import Flask`）]
- [ASSUMPTION: 路由注册通过 `api/routes.py` 的 `register_routes(app)` 统一完成，新端点应在该模块或其子模块内注册]
- [ASSUMPTION: "ISO 字符串"指 ISO 8601 格式（如 `2026-04-19T12:34:56.789Z` 或带时区偏移），时区默认使用 UTC]
- [ASSUMPTION: `timestamp` 每次请求实时生成，非缓存常量]
- [ASSUMPTION: 项目当前已有 pytest 测试基础设施（`conftest.py` 存在），新端点应伴随至少 1 条单元/集成测试]

## 边界情况

- 高频并发调用下不应产生竞态（端点无状态，天然安全）
- 服务器时钟异常或未同步时，`timestamp` 仍应返回当前系统时间，不做校正
- 路由路径大小写敏感：仅 `/api/brain/ping` 匹配,`/api/brain/Ping` 等变体不匹配
- 仅接受 GET 方法，其他方法（POST/PUT/DELETE）返回 405 Method Not Allowed
- 路由不接受任何 query string 或 body 参数，若客户端传入，忽略而非报错

## 范围限定

**在范围内**:
- 新增 `GET /api/brain/ping` 路由与其处理函数
- 返回 JSON `{pong: true, timestamp: <ISO8601>}`
- 至少 1 条自动化测试覆盖 SC-001/SC-002/SC-003
- 在既有路由注册机制（`register_routes`）内挂载新端点

**不在范围内**:
- 鉴权、速率限制、CORS 配置变更
- 修改 `/api/brain/context` 或其他既有 brain 端点
- 前端调用接入、UI 展示
- 监控/日志/链路追踪埋点
- Brain API 整体架构重构或路由前缀调整
- 并发性能压测

## 预期受影响文件

（基于 `server.py` 结构推断,Proposer 在合同阶段核实实际路径）

- `api/routes.py`：路由注册入口,新端点应在此处或其引用的子模块内挂载
- `api/brain/*.py` 或 `api/routes.py` 内对应 brain blueprint 定义文件：新增 `ping` 处理函数的位置(具体文件名由 Proposer 确认)
- `tests/` 下对应测试文件(如 `tests/test_brain_ping.py` 或现有 brain 相关测试文件):新增针对 ping 端点的验收测试
- 可能涉及 `requirements.txt`:若实现选用非标准库 ISO 时间格式化,需评估是否引入依赖(预期不需要,Python 标准库 `datetime.isoformat()` 足够)
