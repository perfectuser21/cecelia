# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: d8f32d83db3cca811cfd3d72670eff0aeeed801e31f6e20c07509a8e291a33af

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作说明与可回归验收合同

## 背景

为宿主及远端调用方提供统一、可核验的 attempt-run 桥接说明，避免端点用途、鉴权、角色、payload 与派发失败回滚语义被误用。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入，按文档选择创建或查询端点、携带正确鉴权及 payload，最终能理解成功查询方式与派发失败后的完整回滚状态。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 用于创建并派发 attempt-run，`GET /api/brain/harness/attempt-run/:id` 用于按 id 查询运行状态。
2. 文档说明两端点使用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 文档逐项列出既有九项角色白名单，并说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，由生产 Brain 自解析。
4. 文档说明派发失败自动回滚为 `run→failed`、`session→closed`、`task→cancelled`，读者可据此判断系统已收敛而非仍在执行。

## 边界情况

- 区分 loopback 与宿主/远端调用，不能把 loopback 免令牌误写成远端免鉴权。
- `base_sha` 仅是可省略字段，不能误写为必填或由调用方随意替代权威实现基线。
- 九项角色必须逐项列全，不能用“等角色”概括。
- 派发失败必须同时说明 run、session、task 三类对象的最终状态。

## 范围限定

**在范围内**：仅新增 `docs/current/` 下的一页中文 attempt-run 桥接使用说明，覆盖端点用途、鉴权、九项角色白名单、payload 字段与失败回滚四节。

**不在范围内**：不修改任何代码、API 行为、鉴权策略、角色白名单、数据库结构或运行配置。

## 假设

- [ASSUMPTION: 文档中的九项角色名称以实现基线 `88929fa377f5bed3cd1876a575c366ff1b93c0d5` 已有白名单为准，验收测试对九项精确集合做断言。]
- [ASSUMPTION: 文档文件名可由实现者在 `docs/current/` 内选择清晰且唯一的名称。]

## 预期受影响文件

- `docs/current/<attempt-run-桥接说明文件>.md`：新增中文使用说明；不得修改代码文件。
- `packages/brain/src/__tests__/<文档合同测试文件>`：若仓库既有文档合同测试允许扩展，则仅用测试断言文档内容；不改变生产代码。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 文档描述必须以实现基线 `88929fa377f5bed3cd1876a575c366ff1b93c0d5` 为准
- 可观测: 文档验收须由测试文件读取真实文档并断言四节及关键字面

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；本任务无 step/feature 锚点，area 返回未绑定 scope 的全局集合，不将无关领域内容误注入本合同 -->
- [基线不漂移] 权威实现基线固定为 `88929fa377f5bed3cd1876a575c366ff1b93c0d5`，不得用角色 checkout 的 base_sha 替代（来源: task contract）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本。
# 期望验收点：测试文件读取 docs/current/ 下新增的中文文档，精确断言两个端点、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN、九项角色白名单、三个必填字段、base_sha 省略语义及三对象回滚状态；并断言生产代码无改动。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 后端桥接 API 的使用说明，不包含用户界面或远端代理协议变更。
## target_environment: local_api
## target_environment_reason: Cecelia 纯后端 API 文档合同在本地 evaluator 通过文件断言验证，无需浏览器或远端机器。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
