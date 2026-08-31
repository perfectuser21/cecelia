# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 5e1b52a69739ae3af7afabbada59ef5b2a447dd41e07ba0f2b113097067e8b71

## OKR 对齐

- **对应 KR**：未配置（Brain context 未提供可可靠锚定的 KR）
- **当前进度**：未配置
- **本次推进预期**：新增一页可执行、可核验的 attempt-run 桥接中文使用说明

## 背景

宿主或远端调用方需要一份统一说明，正确创建 attempt-run、查询运行状态，并理解鉴权、角色、payload 与派发失败回滚合同。

## Golden Path（核心场景）

宿主或远端调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按鉴权与 payload 合同调用 `POST /api/brain/harness/attempt-run` → 使用返回标识调用 `GET /api/brain/harness/attempt-run/:id` → 观察运行状态或失败后的完整回滚状态。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 的创建用途与 `GET /api/brain/harness/attempt-run/:id` 的查询用途。
2. 文档说明两端点采用 `internalAuthOrLoopback`；宿主/远端请求必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，且不得展示真实 token。
3. 文档列出角色白名单九项：`planner`、`proposer`、`adversarial`、`generator`、`generator-fix`、`evaluator`、`judge`、`deployer`、`post-deploy`。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，并由生产 Brain 自解析。
5. 文档说明派发失败自动回滚的最终状态链：`run → failed`、`session → closed`、`task → cancelled`。
6. 读者能仅依据文档识别创建、查询、鉴权、合法角色、字段要求与失败结果。

## 边界情况

- loopback 与宿主/远端鉴权要求不得混写；远端无 Bearer token 不应被描述为可用。
- `base_sha` 只能描述为可省略，不能列入必填字段。
- 派发失败不得描述成遗留 running/open/pending 状态。
- 示例不得包含真实凭据，也不得承诺 thin_prd 未定义的响应字段。

## 范围限定

**在范围内**：仅规划新增 `docs/current/` 下的一页中文说明文档，覆盖两个端点、鉴权、九项角色白名单、payload 字段和派发失败回滚四节。

**不在范围内**：产品代码、API 行为、schema、测试代码、配置及其他文档的修改。

## 假设

- [ASSUMPTION: 文档文件名采用 `docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md`，实现阶段可在不改变目录和主题的前提下使用等价中文命名。]
- [ASSUMPTION: 九项角色名称按当前 Harness 角色合同书写；若权威注册表名称不同，Proposer 必须以注册表为准并保持恰好九项。]

## 预期受影响文件

- `docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md`：新增《attempt-run 桥接使用说明》中文文档。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 文档必须明确派发失败后的三类最终状态

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；仅保留与本纯文档范围直接适用的 area 铁律 -->
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [禁止写死环境] 环境假设值不得写死，应从环境推导（来源: area）
- [真环境验证] 依赖真实环境的接缝断言须在目标环境验证后才算完成（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# proposer 将为 local_api/仓库文档验收填入真实脚本。
# 期望验收点：docs/current/ 存在一页中文 attempt-run 说明；含 POST 与 GET 两端点、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN、恰好九项角色、三个必填字段、base_sha 省略规则及三段失败回滚状态；git diff 不含产品代码。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia Brain attempt-run API 的内部使用说明，且不涉及 UI 或远端 agent 协议实现。
## target_environment: local_api
## target_environment_reason: 文档位于 Cecelia 仓库并描述 Brain API，验收在本地仓库与 localhost Brain 合同环境执行。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
