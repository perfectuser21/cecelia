# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 239fe1b9cb13af9ee1c12171b0671dd016272a07bf59ddfda51e786809fc5946

## OKR 对齐

- **对应 KR**：未配置（Brain context 未提供可锚定 KR）
- **当前进度**：未提供
- **本次推进预期**：在 `docs/current/` 形成可机械验收的中文使用说明

## 背景

宿主或远端调用方需要一页集中说明，正确使用 attempt-run 桥接的创建与查询端点，并理解鉴权、角色、payload 和派发失败后的状态回滚。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按说明鉴权并创建、查询 attempt-run → 能确认请求约束和派发失败后的最终状态。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 的创建用途与 `GET /api/brain/harness/attempt-run/:id` 的查询用途。
2. 文档说明两端点使用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`，且不得披露真实 token。
3. 文档完整枚举九项角色白名单，使读者可逐项核对，不能只写“九项”等概括。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 文档说明派发失败会自动回滚到 `run→failed`、`session→closed`、`task→cancelled`。
6. 读者按四节说明即可判断一次调用是否符合桥接合同；本 sprint 不改变任何运行时行为。

## 边界情况

- loopback 与宿主/远端鉴权场景必须分开表述，避免读者误以为远端可免 token。
- `base_sha` 是可省略字段，不得误列为必填，也不得表述为固定使用角色 checkout 的 base SHA。
- 派发失败必须同时描述 run、session、task 三个最终状态，不能只描述部分状态。

## 范围限定

**在范围内**：仅新增 `docs/current/` 下的一页中文《attempt-run 桥接使用说明》，覆盖两个端点、鉴权、九项角色白名单、payload 字段和失败回滚四节。

**不在范围内**：不修改产品代码、测试代码、API 行为、数据库结构、现有 `docs/current/` 页面或其他最终交付。

## 假设

- [ASSUMPTION: 九项角色的准确名称以实现基线 `5599211397c88c3827d5ce4e9c6061b3802b4fc5` 中服务端白名单为事实源；文档必须逐项照录，禁止猜测或新增别名。]
- [ASSUMPTION: 新文档文件名可由实现角色选择，但必须是 `docs/current/` 直属 Markdown 文件且仅新增该文件。]

## 预期受影响文件

- `docs/current/<attempt-run-bridge-guide>.md`：新增中文使用说明；实际文件名确定后，所有检查均指向该唯一新增文件。

## NFR 约束

- 安全：示例只使用变量名 `CECELIA_INTERNAL_TOKEN`，不得出现真实凭据。
- 可读性：全文使用简体中文，端点、字段名和状态值保留代码字面。
- 一致性：端点、角色白名单和状态转换必须与实现基线一致。
- 其他超时、频控与版本要求：不适用（纯文档变更）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为本 scope 适用铁律 -->
- [分支归属] Planner 必须停留在服务端签发的 planner_branch（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [基线权威] 实现基线来自 task payload，不得由角色 checkout SHA 替换（来源: task contract）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

1. `[ARTIFACT]` 仅有一个新增文件，位于 `docs/current/*.md`；映射检查：`git diff --name-status 5599211397c88c3827d5ce4e9c6061b3802b4fc5...HEAD` 必须只有一行且状态为 `A`。
2. `[BEHAVIOR]` 新文档为中文，并含独立的端点用途、鉴权方式、角色白名单、payload 字段、失败回滚四节；映射检查：文档结构与关键词静态检查脚本。
3. `[BEHAVIOR]` 两个端点字面均存在，鉴权同时含 `internalAuthOrLoopback`、`Bearer`、`CECELIA_INTERNAL_TOKEN`；映射检查：文档关键词静态检查脚本。
4. `[BEHAVIOR]` 角色白名单恰好逐项列出九个服务端允许角色；映射检查：文档角色列表计数检查，并与实现基线白名单测试/常量对照。
5. `[BEHAVIOR]` payload 将 `sprint_dir`、`base_repo`、`branch` 标为必填，将 `base_sha` 标为可省略且由生产 Brain 自解析；映射检查：文档字段语义静态检查脚本。
6. `[BEHAVIOR]` 派发失败明确包含 `run→failed`、`session→closed`、`task→cancelled`；映射检查：文档状态关键词静态检查脚本。
7. `[SCOPE]` 不修改任何代码或既有文档；映射检查：基于 implementation baseline 的 diff allowlist 检查。
8. `[TRACE]` 正文包含精确 `task_request_hash`；映射检查：`grep -Fx` 精确行检查。

```bash
# proposer 将把上述 8 条断言固化为可执行脚本；目标是检查新增文档及基线 diff，不启动或调用外部服务。
```

## journey_type: autonomous
## journey_type_reason: 交付物是后端 Harness API 的使用说明，不含用户界面或远端 agent 协议变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收只需在角色 checkout 中执行本地文档与 git diff 检查。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
