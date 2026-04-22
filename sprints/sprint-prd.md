# Sprint PRD — Harness v6 Reviewer Alignment 哲学真机闭环

## OKR 对齐

- **对应 KR**：Harness v6 自动化研发闭环 KR（Reviewer alignment 验证）
- **当前进度**：闭环组件已就位（Planner / GAN / Runner / Generator / Final E2E），尚无端到端真机验证
- **本次推进预期**：提供一个最小化"哲学真机" Initiative，让 Harness v6 完成一次 Planner → GAN 1-3 轮 APPROVED → B_task_loop → 子 Task 派 Generator → 合并 → Final E2E → done 的完整闭环，证明 Reviewer alignment 改造落地正确

## 背景

Harness v6 完成了 Reviewer alignment 改造（GAN 对抗多轮、B_task_loop 子 Task 派发、Final E2E）。需要一个**尽量简单但足够真实**的 Initiative 作为"哲学真机"（dogfood）端到端跑一遍，验证：

1. Planner 生成的 DAG 能被 Brain Runner 正确落库与调度
2. GAN 对抗在 1-3 轮内达成 APPROVED
3. B_task_loop 能按拓扑顺序逐个派发子 Task 给 Generator
4. 每个子 Task 产出独立 PR 且能被合并
5. Final E2E 能聚合验证所有端点真正工作
6. 任务状态最终回写 `done`

目标功能选定为**极简时间 API**（三个只读端点），避免业务复杂度干扰闭环信号。

## 目标

提供一个可独立运行的最小时间服务，暴露 `/iso`、`/timezone`、`/unix` 三个只读 HTTP 端点，作为 Harness v6 真机闭环的验证载体。

## User Stories

**US-001**（P0）: 作为 Harness v6 维护者，我希望通过调用 `/iso` 端点拿到当前 ISO 8601 时间字符串，以便验证闭环产出的真机在合并后可被真实访问。

**US-002**（P0）: 作为 Harness v6 维护者，我希望通过调用 `/timezone` 端点拿到服务运行所在时区，以便作为第二个独立 Task 推动 B_task_loop 继续派发 Generator。

**US-003**（P0）: 作为 Harness v6 维护者，我希望通过调用 `/unix` 端点拿到当前 Unix 时间戳（秒级整数），以便作为第三个独立 Task 完成多 PR 串联验证。

**US-004**（P0）: 作为 Harness v6 维护者，我希望有一个 E2E 冒烟脚本同时访问三个端点并校验响应，以便 Final E2E 阶段能真机证伪。

## 验收场景（Given-When-Then）

**场景 1**（US-001）:
- Given 哲学真机服务已启动（监听默认端口）
- When 客户端 `GET /iso`
- Then 返回 HTTP 200，Body 为 JSON `{ "iso": "<ISO8601 字符串>" }`，字段符合 `YYYY-MM-DDTHH:mm:ss.sssZ` 格式

**场景 2**（US-002）:
- Given 服务已启动
- When 客户端 `GET /timezone`
- Then 返回 HTTP 200，Body 为 JSON `{ "timezone": "<IANA 时区名>" }`（例如 `Asia/Shanghai` 或 `UTC`），字段非空字符串

**场景 3**（US-003）:
- Given 服务已启动
- When 客户端 `GET /unix`
- Then 返回 HTTP 200，Body 为 JSON `{ "unix": <正整数> }`，值与当前真实 Unix 秒级时间差 ≤ 5 秒

**场景 4**（US-004）:
- Given 服务已启动
- When 运行 E2E 冒烟脚本
- Then 脚本 exit 0；三个端点均返回 200；三个字段都通过格式校验

**场景 5**（错误路径）:
- Given 服务已启动
- When 客户端请求未知路径（例如 `GET /unknown`）
- Then 返回 HTTP 404，Body 为 JSON `{ "error": "not_found" }`

## 功能需求

- **FR-001**: 启动一个 HTTP 服务监听本机端口（默认 `18080`，可通过 `PORT` 环境变量覆盖）
- **FR-002**: 提供 `GET /iso`，返回当前 ISO 8601 时间
- **FR-003**: 提供 `GET /timezone`，返回服务进程所在 IANA 时区
- **FR-004**: 提供 `GET /unix`，返回当前 Unix 秒级时间戳（正整数）
- **FR-005**: 未知路径返回 404 + `{ "error": "not_found" }`
- **FR-006**: 所有响应 `Content-Type: application/json`
- **FR-007**: 提供 E2E 冒烟脚本串联校验三个端点
- **FR-008**: 提供 README 说明如何启动、如何跑 E2E

## 成功标准

- **SC-001**: `/iso` 响应字段符合 ISO 8601 正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`
- **SC-002**: `/timezone` 响应字段为非空字符串
- **SC-003**: `/unix` 响应为正整数，与系统时间差 ≤ 5 秒
- **SC-004**: 未知路径 404 + 约定 JSON 错误体
- **SC-005**: E2E 脚本 exit 0；任一端点失败 exit 非 0
- **SC-006**: 服务可用 `node scripts/harness-dogfood/time-api.js` 单文件启动，无需外部依赖（仅 Node 标准库）
- **SC-007**: Harness v6 闭环运行本 Initiative 后，所有 4 个子 Task 均 `merged=true`，且 Final E2E 跑通，Initiative 状态 `done`

## 假设

- [ASSUMPTION: 真机仅用于 Harness v6 闭环验证，不对外服务，因此无需鉴权、无需持久化、无需 HTTPS]
- [ASSUMPTION: 运行环境 Node.js ≥ 18，支持 `Intl.DateTimeFormat().resolvedOptions().timeZone`]
- [ASSUMPTION: 端口 18080 在闭环执行环境可用；若冲突可通过 PORT 环境变量覆盖]
- [ASSUMPTION: E2E 脚本使用 `curl` 或 Node `fetch`，执行环境已具备 `curl`]

## 边界情况

- **未知路径**：返回 404，不崩溃
- **请求方法非 GET**：返回 405 `{ "error": "method_not_allowed" }`
- **端口占用**：进程退出并输出错误信息（由调用方处理）
- **并发请求**：端点均为只读纯函数式响应，无共享可变状态
- **时区不可识别**：Node 在绝大多数环境会返回 `UTC` 兜底，无需额外处理

## 范围限定

**在范围内**:
- 单文件 Node.js HTTP 服务（`scripts/harness-dogfood/time-api.js`）
- 三个只读端点 + 404/405 处理
- 每端点对应单元测试
- E2E 冒烟脚本（`scripts/harness-dogfood/e2e.sh` 或 `.mjs`）
- README 使用说明

**不在范围内**:
- 鉴权 / HTTPS / CORS
- 日志系统 / 指标上报 / 观测
- 写接口 / 持久化
- 注册到 Brain / 接入 cecelia-dashboard
- 多租户 / 配置中心
- Docker 化（本次闭环直接 `node` 启动即可）

## 预期受影响文件

- `scripts/harness-dogfood/time-api.js`: 主服务文件（HTTP server + 三端点）
- `scripts/harness-dogfood/__tests__/iso.test.js`: `/iso` 单元测试
- `scripts/harness-dogfood/__tests__/timezone.test.js`: `/timezone` 单元测试
- `scripts/harness-dogfood/__tests__/unix.test.js`: `/unix` 单元测试
- `scripts/harness-dogfood/__tests__/not-found.test.js`: 错误路径测试
- `scripts/harness-dogfood/e2e.sh`: Final E2E 冒烟脚本
- `scripts/harness-dogfood/README.md`: 使用说明
