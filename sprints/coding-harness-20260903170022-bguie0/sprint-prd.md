# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: c09e106c61ff86933a9d52beaa3f4394e8482c8a8dad754f0319369ff32ee234

## OKR 对齐

- **对应 KR**：未配置（Brain context 未返回活跃 KR）
- **当前进度**：未提供
- **本次推进预期**：交付一页可机械验收的 attempt-run 桥接使用说明

## 背景

为宿主与远端调用方补齐 attempt-run 桥接的中文使用说明，明确调用入口、鉴权、角色白名单、请求字段和派发失败后的状态回滚，降低错误调用与错误状态残留风险。

## Golden Path（核心场景）

宿主或远端调用方从阅读 `docs/current/` 下的《attempt-run 桥接使用说明》进入 → 按说明鉴权并发起 `POST /api/brain/harness/attempt-run` → 使用返回的标识调用 `GET /api/brain/harness/attempt-run/:id` 查询 → 理解成功状态或派发失败后的完整回滚出口。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 的派发用途与 `GET /api/brain/harness/attempt-run/:id` 的查询用途。
2. 文档说明两端点采用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 文档逐项列出端点接受的九项角色白名单，并明确白名单外角色不可派发。
4. 文档明确 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 文档明确派发失败自动回滚为 `run→failed`、`session→closed`、`task→cancelled`。
6. 读者能仅依该页识别正确请求、查询方式与失败出口。

## 边界情况

- loopback 与宿主/远端调用的鉴权要求不得混写成所有请求均可免鉴权。
- `base_sha` 不得误列为必填，也不得描述为由调用方固定提供。
- 派发失败不得描述为部分回滚或继续运行；三个实体的终态必须完整出现。
- 角色白名单必须恰为九项，不能只写数量或开放任意角色。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文文档；覆盖两个 attempt-run 端点、鉴权、九项角色白名单、payload 字段和失败回滚；提供可由测试文件覆盖的机械验收断言。

**不在范围内**：任何源代码、路由、鉴权逻辑、数据结构、测试实现或既有文档的修改；新增或改变 API 行为。

## 假设

- [ASSUMPTION: 九项角色的具体名称以生产 Brain 当前端点契约中的既有白名单为准；本 sprint 只准确转录，不新增、删减或改名。]
- [ASSUMPTION: Unified Map 未配置，因为 task payload 未同时提供可用的 map_scope 与 map_repo。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`: 新增《attempt-run 桥接使用说明》中文页面；文件名可由实现阶段在 `docs/current/` 内采用等义且唯一的名称。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 文档中的状态与请求字段必须可由测试文件机械断言

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；仅列与本 docs-only sprint 有直接约束关系的活跃铁律 -->
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [环境假设] 环境假设值禁止写死，必须从环境推导或真实校准（来源: area）
- [真环境验证] 依赖生产环境或真实调用方的接缝断言必须真目标验证才算 done（来源: area）
- [Planner 分支] Planner workspace 必须使用服务端签发分支，Provider 不得切换分支（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：机械检查 docs/current/ 新增且仅新增一页中文 Markdown；正文包含 task_request_hash、两个端点原文、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN、恰好九项角色白名单、三个必填 payload 字段、base_sha 可省略且由生产 Brain 自解析、以及 run→failed/session→closed/task→cancelled；同时断言不存在代码文件变更。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 cecelia 仓库内部 API 的 docs-only 使用说明，不涉及 UI 或远端 agent 协议变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；机械验收在对应 macOS Web 执行环境检查仓库文档产物。
## journey_id: none
## step_id: none（PrepPRD 未锚定，gp_anchor=none(docs)）
