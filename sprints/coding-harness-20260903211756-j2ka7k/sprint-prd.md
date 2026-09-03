# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: df2fda65b6ef0fa9cb951485e41daa5124e4267bfdb97b6197c9a3ecc5c14b48

## OKR 对齐

- **对应 KR**：未配置（Brain context 未返回活跃 KR）
- **当前进度**：未提供
- **本次推进预期**：交付一页可机械核验的中文桥接说明

## 背景

为宿主和远端调用方提供统一的 attempt-run 桥接契约说明，降低端点、鉴权、角色、payload 与失败回滚语义被误用的风险。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按环境完成鉴权并通过 `POST /api/brain/harness/attempt-run` 派发 → 使用返回的 id 调用 `GET /api/brain/harness/attempt-run/:id` 查询 → 获得运行状态；派发失败时能确认三类记录已自动回滚到终态。

具体：
1. 文档分别说明 POST 派发端点与 GET 按 id 查询端点的用途。
2. 文档说明 `internalAuthOrLoopback`，并明确宿主/远端请求必须携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`，不得展示真实令牌。
3. 文档单列现有九项角色白名单，名称须与端点接受的权威白名单逐项一致，不增别名。
4. 文档明确 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 文档明确派发失败自动回滚为 `run → failed`、`session → closed`、`task → cancelled`。

## 边界情况

- 非 loopback 且缺少或使用错误 Bearer 令牌时，不应被描述为可调用成功。
- 缺少任一必填字段时，不应被描述为有效派发请求；`base_sha` 不得误写为必填。
- GET 路径中的 `:id` 是 attempt-run 标识，不得写成 task 或 session 标识。
- 派发失败的三个回滚状态必须同时说明，不得只描述部分回滚。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，包含端点、鉴权、九项角色白名单、payload 字段、失败回滚四节及安全占位示例。

**不在范围内**：不修改源代码、测试代码、API 行为、鉴权策略、数据库 schema、角色白名单或其他文档。

## 假设

- [ASSUMPTION: 文档文件名使用清晰的英文短横线命名；中文标题固定为《attempt-run 桥接使用说明》。]
- [ASSUMPTION: 九项角色名称须从端点现有权威白名单逐项转录；输入证据未给出具体名称，因此不得凭空新增或改名。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`: 新增中文桥接使用说明；唯一产品改动。

## DoD（可执行验收计划）

1. [ARTIFACT] `test -f docs/current/attempt-run-bridge-guide.md`，且 `git diff --name-only 5a9c2d06c40622753cb13786ef31e81db8fc18b3 --` 仅输出该文档。
2. [BEHAVIOR] 测试断言中文标题及四个独立章节存在：端点与用途、鉴权、角色白名单、payload 与失败回滚。
3. [BEHAVIOR] 测试精确匹配 POST 与 GET 两个路径，并匹配 `internalAuthOrLoopback`、`Bearer`、`CECELIA_INTERNAL_TOKEN`。
4. [BEHAVIOR] 测试从角色白名单章节解析列表，断言恰有九项、无重复，并与端点权威白名单集合相等。
5. [BEHAVIOR] 测试断言 `sprint_dir`、`base_repo`、`branch` 为必填，且 `base_sha` 明确为可省略并由生产 Brain 自解析。
6. [BEHAVIOR] 测试精确匹配 `run → failed`、`session → closed`、`task → cancelled` 三项失败回滚语义。
7. [BEHAVIOR] 测试扫描文档，断言示例不含真实 token、密钥或凭据值。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 中文文档与当前生产 Brain 的 attempt-run 契约一致
- 可观测: 验收断言必须能机械报告缺失章节、字段或状态语义

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为与本次文档合同直接相关的有效铁律 -->
- [分支一致] Planner workspace 必须保持服务端签发的 planner_branch，不得切换分支（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII、聊天内容不得明文进入日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area）
- [环境假设] 环境假设值不得写死，必须从环境推导（来源: area）
- [真环境验证] 依赖生产环境或真实调用方的接缝断言必须在真实目标验证后才算 done（来源: area）
- [基线固定] 实现基线使用 `5a9c2d06c40622753cb13786ef31e81db8fc18b3`，不得以角色 checkout 基线替换（来源: task contract）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
DOC=docs/current/attempt-run-bridge-guide.md
test -f "$DOC"
test "$(git diff --name-only 5a9c2d06c40622753cb13786ef31e81db8fc18b3 -- | sort)" = "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer.*CECELIA_INTERNAL_TOKEN' "$DOC"
grep -q 'sprint_dir' "$DOC" && grep -q 'base_repo' "$DOC" && grep -q 'branch' "$DOC"
grep -q 'base_sha.*可省略.*生产 Brain.*自解析' "$DOC"
grep -q 'run.*failed' "$DOC" && grep -q 'session.*closed' "$DOC" && grep -q 'task.*cancelled' "$DOC"
# proposer 应补充：解析角色白名单章节并与端点权威九项白名单做集合相等断言。
```

## journey_type: autonomous
## journey_type_reason: 交付物仅为 Cecelia 后端桥接 API 的使用说明，不包含 UI 或远端协议实现变更。
## target_environment: local_api
## target_environment_reason: 在本地仓库机械核验文档及当前生产 Brain API 契约。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
