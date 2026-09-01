# Sprint PRD — attempt-run 桥接使用说明文档

task_request_hash: f8a230c74afec50490296e622a710725476d3658cd40e15b1a07cc0c4372f623

## OKR 对齐

- **对应 KR**：未配置（Brain context 未返回活跃 KR）
- **当前进度**：未配置
- **本次推进预期**：交付一页可独立使用和机器验收的 attempt-run 桥接中文说明

## 背景

attempt-run 桥接需要一页统一说明，使调用方能够正确派发、查询并理解失败回滚结果，避免鉴权、角色或 payload 使用错误。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 依次确认 `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 的用途和鉴权 → 核对九项角色白名单与 payload 字段 → 理解派发失败后的状态回滚 → 能据此正确使用接口。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 的派发用途和 `GET /api/brain/harness/attempt-run/:id` 的查询用途。
2. 文档说明两端点采用 `internalAuthOrLoopback`，并明确宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 文档以九个独立条目完整列出现行角色白名单，名称与生产 Brain 接口允许值一致。
4. 文档明确 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 文档明确派发失败会自动形成 `run→failed`、`session→closed`、`task→cancelled` 三项结果。
6. 读者完成上述检查后，得到可直接用于桥接调用的中文说明；本 Sprint 不改变接口行为。

## 边界情况

- 区分 loopback 与宿主/远端调用，禁止让远端读者误以为可以省略 Bearer 凭据。
- 区分 payload 必填项与可省略的 `base_sha`，禁止把后者写成调用方必填。
- 回滚说明必须同时覆盖 run、session、task 三个对象及其目标状态。
- 九项角色白名单必须逐项列出，不能仅写“支持九种角色”。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖两个端点、鉴权、九项角色白名单、payload 字段和派发失败自动回滚。

**不在范围内**：不修改任何代码、测试、接口、鉴权逻辑、角色白名单、数据模型、运行配置或其他文档；不发起真实 attempt-run 派发。

## 假设

- [ASSUMPTION: 文档文件名采用可表达主题的 `docs/current/ATTEMPT_RUN_BRIDGE.md`，最终名称可由既有文档命名规范约束，但必须位于 `docs/current/`。]
- [ASSUMPTION: 九项角色名称以生产 Brain 当前允许值为准，文档验收时需与对应测试夹具中的白名单一致。]
- [ASSUMPTION: 本任务仅要求静态文档准确性，不要求通过真实网络调用验证端点。]

## 预期受影响文件

- `docs/current/ATTEMPT_RUN_BRIDGE.md`：新增 attempt-run 桥接中文使用说明。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 语言：全文使用简体中文，端点、字段、角色和状态等标识符保留原名。
- 安全：不得写入真实 `CECELIA_INTERNAL_TOKEN`；仅说明 Bearer 使用方式。
- 准确性：角色白名单、必填字段和回滚状态须与生产 Brain 行为一致。
- 可测试性：四个主题分别成节，九项角色逐项列出，便于测试文件进行静态断言。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；与本次文档范围直接相关的约束 -->
- [凭据安全] 不提交或展示真实 API Key、Token 或密钥（来源: area）
- [范围隔离] 本 Sprint 仅新增文档，不修改任何代码或运行状态（来源: PrepPRD）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：测试文件静态验证 docs/current/ 下新增且仅新增一页中文文档；文档存在两个端点、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN、九项角色、三个必填字段、base_sha 省略规则，以及 run→failed/session→closed/task→cancelled；git diff 不含代码变更。
```

## journey_type: autonomous
## journey_type_reason: 本 Sprint 是无交互流程变化的仓库文档交付，默认归为 autonomous。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在 macOS Web 执行面进行静态文档与 git diff 检查。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
