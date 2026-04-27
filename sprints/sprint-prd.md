# Sprint PRD — Initiative B2：建立 Initiative 标识与发现入口

## OKR 对齐

- **对应 KR**：KR-Harness（Harness 端到端流水线可用性）
- **当前进度**：未知（Brain API 在当前规划环境不可达，[ASSUMPTION: 30%]）
- **本次推进预期**：+5%（贡献一个完整 Initiative 用于验证预检 → 规划 → 生成 → 评估 闭环）

## 背景

Harness v2 的预检（pre-flight check）要求 Initiative 描述足够具体且可被流水线消费。当前缺少一个稳定的最小 Initiative 用例，导致预检回归与 Runner 调试只能用临时 fixture，不利于回归追踪。本 Initiative 承担两个角色：

1. 作为长期存在的"参考 Initiative"，让 Harness Planner / Runner / Evaluator 的回归测试有一个稳定锚点
2. 验证预检通过路径在真实 Initiative 描述长度下的行为

## 目标

提供一个被官方记录、可被 Brain 与回归测试发现的 Initiative B2 标识入口，让后续任何阶段（plan / generate / evaluate）都能引用它做端到端冒烟。

## User Stories

- **US-001**（P0）: 作为 Harness 维护者，我希望存在一个稳定的 Initiative B2 清单文件，以便回归脚本固定引用它做端到端冒烟
- **US-002**（P0）: 作为 Brain 调度器，我希望能通过既定路径发现 Initiative B2 的元数据，以便派发 task 时不依赖临时 fixture
- **US-003**（P1）: 作为新接手的开发者，我希望仓库文档索引能指向 Initiative B2 入口，以便快速理解 Harness 预检的期望输入形态

## 验收场景（Given-When-Then）

**场景 1**（US-001）:
- Given Initiative B2 清单文件已纳入仓库
- When 回归脚本读取该清单
- Then 能拿到 initiative_id、标题、描述（长度 ≥ 60 字符）三个字段，且字段值与 PRD 一致

**场景 2**（US-002）:
- Given Brain 派发 task 需要 Initiative B2 元数据
- When 通过既定发现入口请求 Initiative B2 元数据
- Then 返回结构化对象（包含 initiative_id / title / description / status），且 status 为 active

**场景 3**（US-003）:
- Given 新开发者打开仓库文档索引
- When 检索 "Initiative B2"
- Then 能在索引中找到一条指向 Initiative B2 入口的链接

## 功能需求

- **FR-001**: 仓库根下存在 Initiative B2 的标识清单（含 initiative_id、title、description、status 字段）
- **FR-002**: 提供从代码可调用的发现入口，返回 Initiative B2 元数据（不引入新依赖）
- **FR-003**: 文档索引存在指向 Initiative B2 标识清单的稳定链接
- **FR-004**: 存在一个最小自动化检查，证明 FR-001 / FR-002 / FR-003 三者协同正确

## 成功标准

- **SC-001**: Initiative B2 清单文件被仓库追踪，且描述字段长度 ≥ 60 字符
- **SC-002**: 发现入口在调用一次后返回的 status 字段值等于 `active`
- **SC-003**: 文档索引中"Initiative B2"关键词命中条目数 ≥ 1
- **SC-004**: 自动化检查在干净仓库 checkout 后单次运行 exit code = 0

## 假设

- [ASSUMPTION: KR-Harness 当前进度 30%，因 Brain `/api/brain/context` 在规划环境不可达]
- [ASSUMPTION: Brain Runner 接受 task-plan.json 中 task_id 为字符串 `ws1..ws4` 形态]
- [ASSUMPTION: 仓库尚无同名 Initiative 标识清单文件，避免冲突]

## 边界情况

- 重复执行发现入口应幂等，不产生副作用
- 清单文件被删除时，自动化检查应明确报错并指向缺失项，而非静默通过
- 文档索引重复条目时，自动化检查计数应大于等于 1 即视为通过

## 范围限定

**在范围内**:
- Initiative B2 标识清单（数据）
- 一个发现入口（读取数据，无写操作）
- 一处文档索引登记
- 一项最小自动化检查

**不在范围内**:
- 不创建新的 HTTP 端点
- 不修改 Brain 调度逻辑
- 不引入新依赖
- 不改变任何现有 CI 工作流（仅追加一项独立检查）

## 预期受影响文件

- `sprints/initiative-b2/manifest.json`：Initiative B2 标识清单（新增）
- `sprints/initiative-b2/discover.mjs`：发现入口脚本（新增，纯读取，无副作用）
- `docs/current/README.md`：在文档索引追加 Initiative B2 条目
- `sprints/initiative-b2/check.mjs`：最小自动化检查（新增，调用 discover.mjs 校验三项协同）
