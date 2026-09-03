# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 62b47ad7da0dfb280c5b3c471cb47a6ba7c25efcc358f56d5c7695c7aaae18ab

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：通过补齐 attempt-run 桥接说明降低接入歧义

## 背景

宿主机与远端调用方需要一份中文说明，准确描述 attempt-run 桥接的入口、查询、鉴权、角色、payload 和失败回滚语义。

## Golden Path（核心场景）

宿主机或远端调用方从阅读 `docs/current/` 下的《attempt-run 桥接使用说明》进入 → 按鉴权与 payload 约束调用 `POST /api/brain/harness/attempt-run` → 使用返回的标识调用 `GET /api/brain/harness/attempt-run/:id` 查询 → 能判断派发结果或失败后的回滚状态。

具体：
1. 文档分别说明 POST 创建/派发 attempt-run 与 GET 按 id 查询状态的用途。
2. 文档说明两端点使用 `internalAuthOrLoopback`；宿主/远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 文档完整列出九项角色白名单，并列明 payload 必填 `sprint_dir`、`base_repo`、`branch`，以及 `base_sha` 可省略并由生产 Brain 自解析。
4. 文档说明派发失败会自动回滚为 `run→failed`、`session→closed`、`task→cancelled`。
5. 测试文件可逐项断言文档存在、为中文、四节与全部契约字面齐全，且变更集中于文档。

## 边界情况

- 明确区分 loopback 与宿主/远端鉴权要求，避免把 loopback 例外描述为远端免鉴权。
- 九项角色必须逐项出现，不能用“等角色”省略。
- `base_sha` 不得误列为必填字段。
- 派发失败的三个对象及其终态必须同时出现。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖两个端点、鉴权、九项角色白名单、payload 字段及失败回滚；为后续测试文件提供可机检字面断言。

**不在范围内**：不修改任何代码、端点行为、鉴权逻辑、角色白名单、数据库状态机或既有文档。

## 假设

- [ASSUMPTION: 九项角色的权威名称由 proposer 从当前接口契约/测试注册表读取，并在验收合同中逐项锁定；PrepPRD 只给出数量，未给出名称。]
- [ASSUMPTION: 本任务未锚定 Journey Step，按文档型独立 sprint 处理。]

## 预期受影响文件

- `docs/current/attempt-run-bridge.md`: 新增中文 attempt-run 桥接使用说明；文件名可由 proposer 在合同中锁定，但必须位于 `docs/current/`。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 文档必须能由测试文件以确定性字面断言覆盖。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；下列为与本范围直接相交的有效铁律 -->
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [分支权威] Planner workspace 必须保持服务端签发的 planner_branch，不得自行切换分支（来源: area）
- [验证命令] 合同里的验证命令必须实跑确认 exit code 语义（来源: area）
- [真环境验证] 依赖真实调用方的接缝断言必须在真实目标验证后才算 done（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：测试文件断言 docs/current/ 下新增中文说明存在，且四节内容、两个端点、鉴权字面、九项角色、payload 字段和三段回滚终态全部齐全；git diff 证明没有代码变更。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 仓库内部 API 桥接说明文档，不含用户界面或远端代理协议变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web，由本机环境执行文档契约测试。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
