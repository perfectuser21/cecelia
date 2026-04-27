# Sprint PRD — Initiative B1 基础脚手架

## OKR 对齐

- **对应 KR**：KR-B1（Initiative B1 — 基础工程闭环）
- **当前进度**：0%
- **本次推进预期**：60%（完成最小可运行闭环 + 验收脚本）

## 背景

Initiative B1 是一条新建初始化条线，目前缺少独立的目录结构、入口模块、配置面板和验收脚本。本次目标是把一条最小但完整的"配置 → 入口 → 行为 → 验收"链路立起来，使后续功能扩展不再受脚手架缺失阻塞。脚手架不引入业务逻辑，只负责为后续 Initiative B 系列工作提供稳定挂载点。

## 目标

让 Initiative B1 拥有可独立运行、可独立验证的最小骨架：用户能用单条命令拉起入口、读到默认配置生效、并通过验收脚本拿到一份 PASS 报告。

## User Stories

**US-001**（P0）: 作为开发者，我希望存在一个独立的 Initiative B1 入口模块，以便后续功能能挂载到稳定路径下。
**US-002**（P0）: 作为开发者，我希望 Initiative B1 入口能加载并应用默认配置，以便不同环境下的行为可控。
**US-003**（P1）: 作为开发者，我希望存在一份 Initiative B1 验收脚本，以便每次改动后能快速确认骨架仍然健康。

## 验收场景（Given-When-Then）

**场景 1**（US-001）:
- Given 仓库已克隆且依赖已安装
- When 运行 Initiative B1 入口命令（不带任何参数）
- Then 进程启动成功、退出码为 0、stdout 输出可识别的启动横幅

**场景 2**（US-002）:
- Given 已存在默认配置文件
- When 入口模块启动时读取配置
- Then 启动日志中包含配置中的可识别字段值，证明配置确实被加载

**场景 3**（US-003）:
- Given Initiative B1 骨架已实现
- When 运行 Initiative B1 验收脚本
- Then 脚本输出 PASS 且退出码为 0；任一场景失败时退出码非 0

## 功能需求

- **FR-001**: 在仓库内开辟独立 Initiative B1 目录树，包含入口模块、配置文件、验收脚本三类文件，互不耦合。
- **FR-002**: Initiative B1 入口必须能在不依赖外部网络的情况下启动；启动时输出可识别横幅。
- **FR-003**: Initiative B1 默认配置文件包含至少一个可观察字段；入口加载配置后必须把该字段回显到日志。
- **FR-004**: Initiative B1 验收脚本必须串起场景 1/2/3，逐项断言；任一断言失败必须返回非零退出码并打印失败原因。
- **FR-005**: README 或等价说明文件清楚列出"如何运行入口""如何运行验收"两条命令。

## 成功标准

- **SC-001**: Initiative B1 入口启动后退出码为 0 的概率为 100%（在干净环境中）。
- **SC-002**: 验收脚本能把 3 个验收场景串起来，且任一场景错误时整脚本退出码非 0。
- **SC-003**: Initiative B1 目录新增代码量在脚手架范围内（< 400 LOC，符合 capacity-budget hard 阈值）。
- **SC-004**: Initiative B1 文件树可被 `git ls-files` 列出，无未追踪残留。

## 假设

- [ASSUMPTION: 任务描述"Initiative B1 with sufficiently long description for pre-flight check passing"为 harness 合成测试用例，未指明具体业务功能，故按"建立 Initiative B1 最小脚手架闭环"理解]
- [ASSUMPTION: Initiative B1 的目录可直接放在仓库根级 `initiatives/b1/` 下，未与其他既有 Initiative 命名冲突]
- [ASSUMPTION: 入口语言/技术栈与仓库主语言一致；配置格式采用仓库已有约定]
- [ASSUMPTION: 验收脚本使用 bash 即可，不引入新测试框架]

## 边界情况

- 配置文件缺失时：入口必须明确报错并以非零退出码退出，而不是用空配置静默启动。
- 入口被重复启动：第二次启动行为应等价于第一次（无副作用残留），脚手架阶段不要求并发互斥。
- 验收脚本在缺少入口可执行权限时：必须输出可读的失败提示，而不是模糊 stack trace。

## 范围限定

**在范围内**:
- Initiative B1 目录骨架
- 入口模块、默认配置、验收脚本
- README 一段使用说明

**不在范围内**:
- 任何具体业务逻辑（计算、调度、数据持久化）
- CI workflow 接入（留待后续 Initiative）
- 与 Brain / Engine 的实际联调
- 国际化、性能优化、可观测性栈

## 预期受影响文件

- `initiatives/b1/`: 新增目录根
- `initiatives/b1/entry.*`: 新增入口模块
- `initiatives/b1/config/default.*`: 新增默认配置
- `initiatives/b1/scripts/verify.sh`: 新增验收脚本
- `initiatives/b1/README.md`: 新增说明文件
