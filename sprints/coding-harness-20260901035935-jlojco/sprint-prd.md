# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: c924fc0993e2c65b62e0f01b222ece3c65b6f0090c735a5e33a77291188e36c0

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的操作者文档，不承诺修改运行时进度百分比

## 背景

宿主机与远端调用方需要一页统一的中文说明，准确使用 attempt-run 桥接，并理解鉴权、角色、请求字段及派发失败后的状态收敛行为。

## Golden Path（核心场景）

操作者从 `docs/current/` 下的《attempt-run 桥接使用说明》进入 → 按说明创建并查询 attempt-run → 能确认派发结果或失败回滚后的终态。

具体：
1. 操作者阅读 `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 的用途及鉴权方式；说明明确 `internalAuthOrLoopback`，宿主/远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
2. 操作者从文档确认九项角色白名单，并以其中一个合法角色提交请求。
3. 操作者提交包含 `sprint_dir`、`base_repo`、`branch` 的 payload；文档说明 `base_sha` 可省略并由生产 Brain 自解析。
4. 操作者通过查询端点观察运行状态；若派发失败，文档明确状态依次收敛为 `run→failed`、`session→closed`、`task→cancelled`。

## 边界情况

- 回环请求与宿主/远端请求的鉴权要求不得混写，远端示例不得省略 Bearer token。
- 文档不得把 `base_sha` 描述为必填，也不得把失败回滚描述为部分成功。
- 九项角色白名单必须完整列出，且不得自行扩展第十项。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，包含端点用途与鉴权、九项角色白名单、payload 字段、派发失败自动回滚四节。

**不在范围内**：任何代码、API、数据库、配置、既有文档及其他目录的改动；不改变 attempt-run 当前行为。

## 假设

- [ASSUMPTION: 文档文件名使用仓库既有命名约定确定，但标题必须为《attempt-run 桥接使用说明》。]
- [ASSUMPTION: 九项角色名称以实现基线 `46221f91778af50e1be078f1e542ec5c17360126` 已存在的服务端白名单为准，文档只转述，不创造新角色。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增中文 attempt-run 桥接使用说明；唯一预期产物。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 以实现基线 `46221f91778af50e1be078f1e542ec5c17360126` 的接口行为为准
- 可观测: 文档必须说明可通过 GET 查询 run 状态及派发失败后的三类终态

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；本任务适用的 active area 铁律 -->
- [凭据隔离] 宿主或远端操作必须使用调用方获授权的 `CECELIA_INTERNAL_TOKEN`，不得混用他人凭据（来源: area）
- [基线不漂移] 文档事实以 implementation baseline `46221f91778af50e1be078f1e542ec5c17360126` 为准，不以角色 checkout 替换（来源: task contract）
- [仅文档] 本 sprint 不得修改任何代码（来源: task contract）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：docs/current/ 下存在唯一新增中文说明页；正文可机械检出两个端点、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN、九项角色、三个必填字段、base_sha 可省略，以及 run→failed/session→closed/task→cancelled；git diff 不含代码文件。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 仓库内部 API 的使用说明文档，不含用户界面或远端 agent 协议变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在该角色目标机器的仓库 checkout 中检查文档内容与 diff。
## journey_id: none
## step_id: none（PrepPRD 锚定为 docs，无 Journey Step）
