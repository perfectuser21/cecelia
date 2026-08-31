# Sprint PRD — attempt-run 桥接使用说明

## OKR 对齐

- **对应 KR**：未配置（Brain context 未返回活跃 KR）
- **当前进度**：未提供
- **本次推进预期**：形成可验证的 attempt-run 桥接说明文档

## 背景

为宿主及远端调用方提供统一的 attempt-run 桥接使用说明，减少端点用途、鉴权、角色、请求字段和失败回滚语义的误用。

## Golden Path（核心场景）

宿主或远端调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按说明携带鉴权与完整 payload 调用 `POST /api/brain/harness/attempt-run` → 使用返回标识调用 `GET /api/brain/harness/attempt-run/:id` 查询 → 能明确判断运行状态及派发失败后的回滚结果。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 的派发用途与 `GET /api/brain/harness/attempt-run/:id` 的查询用途。
2. 文档说明鉴权采用 `internalAuthOrLoopback`，并明确宿主或远端请求必须携带 `Bearer CECELI…OKEN`。
3. 文档完整列出九项角色白名单，并列明 payload 必填字段 `sprint_dir`、`base_repo`、`branch`；说明 `base_sha` 可省略并由生产 Brain 自解析。
4. 文档说明派发失败时自动回滚为 `run→failed`、`session→closed`、`task→cancelled`，读者可据此核对失败终态。

## 边界情况

- 回环调用与宿主/远端调用的鉴权要求不得混写；宿主/远端必须带 Bearer 凭据。
- `base_sha` 省略是受支持行为，不得误写为必填字段。
- 派发失败回滚必须同时覆盖 run、session、task 三类对象及各自终态。
- 九项角色必须完整列出，不得以“等角色”省略。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖端点用途与鉴权、九项角色白名单、payload 字段、派发失败自动回滚四节。

**不在范围内**：不修改任何代码、测试、配置、接口行为或既有文档；不新增端点；不改变鉴权或回滚逻辑。

## 假设

- [ASSUMPTION: 九项角色的准确名称以实现基线 `1ef19bd6f70b79e14a20ecb0e37ba8492f71a029` 中生产 Brain 的现行白名单为准，文档须逐项照录。]
- [ASSUMPTION: 新文档文件名可由实现角色按 `docs/current/` 现有命名约定确定。]

## 预期受影响文件

- `docs/current/<attempt-run-桥接使用说明文件>.md`：新增中文使用说明；这是唯一允许变更的文件。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 语言：中文。
- 准确性：端点、鉴权、角色、字段与回滚终态必须与实现基线一致。
- 变更边界：不得修改任何代码。
- 可观测：验收可通过文件路径、章节文字和 git diff 机械检查。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；本任务适用项 -->
- [凭据隔离] 宿主或远端操作必须使用对应授权凭据，不得混用授权（来源: area）
- [基线权威] 文档中的生产行为必须以 implementation baseline 的生产 Brain 为准，不得由本角色 checkout 基线替换（来源: task contract）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：docs/current/ 下仅新增一页中文文档；文档具有端点用途与鉴权、九项角色白名单、payload 字段、派发失败自动回滚四节；git diff 不含代码文件。
```

## 可测试验收断言

1. `docs/current/` 下存在且仅新增一页说明文档，正文包含中文字符。
2. 文档同时包含 `POST /api/brain/harness/attempt-run`、`GET /api/brain/harness/attempt-run/:id`、`internalAuthOrLoopback` 与 `Bearer CECELI…OKEN` 字面。
3. 文档有独立的角色白名单章节，按实现基线逐项列出且机械计数恰为九项。
4. 文档明确 `sprint_dir`、`base_repo`、`branch` 为 payload 必填字段，并明确 `base_sha` 可省略、由生产 Brain 自解析。
5. 文档同时包含 `run→failed`、`session→closed`、`task→cancelled` 三条派发失败自动回滚终态。
6. 相对实现基线的变更文件全部位于 `docs/current/`，且仅包含目标 Markdown 文档，不含代码、测试或配置变更。

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 纯后端 attempt-run API 的使用说明，无用户界面或远端 agent 协议变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；文档验收在当前 Cecelia checkout 上执行文件与 diff 检查。
## journey_id: none
## step_id: none（PrepPRD 未锚定，gp_anchor=none(docs)）
