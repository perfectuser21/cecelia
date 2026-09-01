# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 2a31afc47dd27591a301310ae5f11092cb1c7a6c056e07de0442daa9797bf01e

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的中文使用说明与可执行验收合同

## 背景

为宿主及远端调用方提供统一、可核验的 attempt-run 桥接使用说明，减少端点用途、鉴权、派发参数和失败回滚语义的误用。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 依据说明鉴权并提交 attempt-run → 使用返回的 id 查询状态 → 在派发失败时识别完整回滚结果。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 的派发用途与 `GET /api/brain/harness/attempt-run/:id` 的状态查询用途。
2. 文档说明两端点使用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Bearer CECELIA_BRAIN_TOKEN`，不得展示真实凭据。
3. 文档逐项列出九项角色白名单：`planner`、`proposer`、`skeptic`、`generator`、`generator-fix`、`evaluator`、`judge`、`reporter`、`controller`。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`，并说明 `base_sha` 可省略且由生产 Brain 自解析。
5. 文档说明派发失败后的自动回滚终态：run → `failed`、session → `closed`、task → `cancelled`。
6. 读者可通过文档测试获得“文件存在、中文、四节齐全、无代码改动”的确定结果。

## 边界情况

- 区分 loopback 内部访问与宿主/远端访问，禁止让远端读者误以为可以省略 Bearer 鉴权。
- `base_sha` 是可选字段，不得与三个必填字段并列为必填。
- 回滚说明必须同时覆盖 run、session、task 三个对象及各自终态。
- 文档只描述既有接口，不承诺新增或改变接口行为。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》；覆盖两个端点、鉴权、九项角色白名单、payload 字段及派发失败回滚。

**不在范围内**：任何源代码、配置、API 行为、数据库结构和 `docs/current/` 之外文件的修改。

## 假设

- [ASSUMPTION: 九项角色白名单按当前桥接合同命名为 planner、proposer、skeptic、generator、generator-fix、evaluator、judge、reporter、controller；proposer 必须用权威接口合同校验名称后再固化。]
- [ASSUMPTION: 文档测试文件采用 `packages/brain/test/attempt-run-bridge-doc.test.js`，由后续合同阶段确认仓库测试约定。]
- [ASSUMPTION: task payload 未配置 map_scope/map_repo，因此 Unified Map 状态记为未配置，不做领域映射猜测。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增中文使用说明，且是唯一产品交付文件。
- `packages/brain/test/attempt-run-bridge-doc.test.js`：仅作为各验收断言的测试映射；本 sprint 范围明确禁止新增或修改该文件，验收器可用等价外部检查执行。

## 验收断言与测试映射

- A1：`docs/current/attempt-run-bridge-guide.md` 存在且正文为中文。测试文件：`packages/brain/test/attempt-run-bridge-doc.test.js`。
- A2：文档分别包含 POST 与 GET 端点用途，以及 `internalAuthOrLoopback` 和宿主/远端 Bearer token 规则。测试文件：`packages/brain/test/attempt-run-bridge-doc.test.js`。
- A3：文档角色白名单恰好覆盖 Golden Path 所列九项。测试文件：`packages/brain/test/attempt-run-bridge-doc.test.js`。
- A4：文档将 `sprint_dir`、`base_repo`、`branch` 标为必填，并将 `base_sha` 标为可省略、由生产 Brain 自解析。测试文件：`packages/brain/test/attempt-run-bridge-doc.test.js`。
- A5：文档包含 run→failed、session→closed、task→cancelled 的完整失败回滚链。测试文件：`packages/brain/test/attempt-run-bridge-doc.test.js`。
- A6：相对实现基线 `5599211397c88c3827d5ce4e9c6061b3802b4fc5`，交付 diff 仅含 `docs/current/attempt-run-bridge-guide.md`，不含代码。测试文件：`packages/brain/test/attempt-run-bridge-doc.test.js`。

## NFR 约束

- 超时/延迟：待定（PrepPRD 未指定）
- 频控：待定（PrepPRD 未指定）
- 版本要求：中文说明；端点、字段及状态名称须保持字面准确
- 可观测：每条验收断言必须映射到测试文件，且不得记录真实 token

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII、聊天内容不得明文进日志（来源: area）
- [分支归属] Planner workspace 必须保持服务端签发的 planner_branch，Provider 不得切换分支（来源: area）
- [验证命令] 合同验证命令写入前须实跑并确认 exit code 语义（来源: area）
- [真环境验证] 依赖真实调用方的接缝断言须在目标环境验证后才算 done（来源: area）
- [共享文件禁区] 未经合同授权不得修改跨 sprint 共享判定文件（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：从实现基线核对 diff，确认唯一新增交付为 docs/current/ 中文说明，并逐条验证 A1-A6。
```

## journey_type: autonomous
## journey_type_reason: 交付仅为 Cecelia 仓库内部 API 使用说明文档，不含用户界面或远端 agent 协议变更
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在 Cecelia 宿主工作区执行文档与 diff 检查
## journey_id: none
## step_id: none（PrepPRD 未锚定）
