---
name: workflow-authoring
description: 当用户要求创建、注册或更新 workflow，或把已经跑通的做法固化为可复用流程时使用。适用于 OpenClaw 对话入口；只执行既有业务流程或一般概念问答不触发。
---

# 创建与更新工作流

这是一个六骨干活动的管理 workflow。你是当前对话的执行者，按服务器返回的阶段连续执行；需要开发时调用现有 `/dev`，完成后回到本流程。Brain 保存任务、阶段和证据，禁止另建 Notion／飞书任务账或直接修改数据库。不要仅创建六个任务就宣称流程可运行。

## 调用入口

用户说“创建／更新 workflow”即进入此流程。复用本会话已有请求身份；后续补充、重试和恢复沿用同一 task_id。只追问实际缺少的目标或验收条件，已有授权持续有效。

使用本 skill 同目录的 `scripts/client.mjs`（Node.js 22+）。环境变量 `CECELIA_API_BASE_URL` 默认 `http://localhost:5221/api/brain`。敏感 API 使用 `CECELIA_INTERNAL_TOKEN`，按组织凭据规则从 1Password 注入环境，绝不把凭据写入 JSON、输出或命令参数。执行前确认脚本路径与 API 在同一执行机可达；网关文件路径不能直接交给远端节点。

OpenClaw 使用 Codex 隔离执行器时，原生 `bash` 可能位于另一个执行环境。调用本流程的 Brain API 和本地脚本时优先使用 `gateway_exec`，让请求 JSON、调用器、凭据缓存和 `localhost:5221` 留在同一网关宿主；先按该工具定义填写参数。若文件不可见或 localhost 不通，检查执行主机并切换到网关工具，不把这类内部路径问题交给用户补资料。只有确认当前工具与网关同机时才直接用原生终端。

将请求保存为 JSON，再调用：

```text
node <本skill绝对路径>/scripts/client.mjs start --request <请求JSON绝对路径>
node <本skill绝对路径>/scripts/client.mjs status --task-id <返回的task_id>
node <本skill绝对路径>/scripts/client.mjs submit --task-id <task_id> --stage <当前阶段> --output <阶段输出JSON绝对路径>
```

请求字段：`request_key`（当前入站消息稳定ID，仅字母数字及`_.:-`）、`operation`（create/update）、`goal`、`actor`（当前实际执行者）。更新还须 `workflow_id`、`expected_version`（当前工作流版本，如`1.0.0`）。脚本先登记任务并认领；只有返回真实 task_id 才继续。

## 六个骨干活动

| 阶段 | 执行工作 | 提交的输出 |
|---|---|---|
| intake · 理解需求 | 明确目标、输入输出、验收、所属现有能力。已有成功任务可作证据；更新时读取现状 | `goal`、`inputs`字符串数组、`outputs`字符串数组、`acceptance`非空字符串数组、`capability_id`；更新加`workflow_id` |
| reuse · 查目录复用 | 阅读服务器在 intake 后保存的完整`state.catalog`。比较输入输出、环境、权限、合同和版本；名字相似只算候选 | `search_terms`非空字符串数组；`candidates:[{kind:skill/activity/workflow,id,decision:reuse/adapt/reject,reason}]`；无候选时加`no_match_reason` |
| compose · 确定组装方案 | 形成有序活动、具体实现、调用入口和每活动验收。采用skill可复用实现；共享activity用原UUID及合同摘要 | `definition`，格式见下一节 |
| build · 补齐能力 | 纯复用则核对实际入口。缺skill或代码时登记子开发任务并走`/dev`、PR、CI与实际部署验收；禁止直接改生产或绕过门禁 | `implementation_task_ids`数组、`reuse_only`布尔值、`evidence_refs`非空数组；实施任务必须真实completed |
| verify · 整链验证 | 调用实际入口验证组合和全部活动，保存真实产出。独立验证任务写结构化回执；不得以目录active、脚本exit 0或自己说成功代替 | `validation_task_id`（已完成且与管理任务不同） |
| register · 正式登记 | 提交空对象，由服务器检查证据、版本、引用，事务登记并回读 | `{}`；使用服务器返回的真实workflow_id和activity_ids |

每次提交成功后，读取`state.stage`，直接执行下一活动。阶段失败不推进；修复缺失证据后重交同阶段。登记网络中断先查状态再重试，不重做前五阶段。修订已冻结定义时新建管理请求，引用上一任务；原验证回执不能用于变更后的定义。

同一原因连续失败三次时保留阶段、证据和具体缺口，停止自动重试并报告；没有新证据不循环提交。收到用户补充或依赖完成后，用原task_id恢复。缺能力的开发子任务挂`parent_task_id`，实际开发仍走既有`/dev`。

## 组装定义

`definition`必须包含：

- `key`：稳定英文标识；`name`：中文名称；`capability_id`：有父价值流的既有能力UUID。
- `channel`、`form`、`version`：渠道、执行形态和三段数字版本（例如`1.0.0`）。更新必须升版；回退到旧内容也发布新版本并重新验证。
- `source:{ref,revision}`：定义的仓库路径及固定commit/SHA256。禁止使用`main`或`latest`充当固定版本。
- `runtime:{skill_id,entrypoint}`：已登记的整体OpenClaw调用skill及实际入口。
- `activities:[{key,name,executor_kind,implementation,acceptance}]`：有序骨干活动。`executor_kind`为agent/code/human；`implementation:{kind,ref,version,skill_id?}`；kind为skill时必须引用真实skill_id；acceptance为非空字符串数组。
- 共享活动另带`reuse_activity_id`和`reuse_contract_sha256`，不得复制共享活动真身。共享引用底座未就绪时如实记录缺口。

compose返回`definition_sha256`。所有后续产出必须针对这个精确指纹。候选skill可以先按`planned`登记，发布前必须实际存在并转为active；引用需要变动时重新形成定义和验证。

本管理workflow自身也用相同定义和登记入口。`scripts/self-definition.mjs --capability-id <真实UUID> --skill-id <真实UUID> --revision <skill来源commit>`生成六活动定义；先完成本身的整链验收，再登记，不因它是管理流程而豁免。

## 验证回执

验证者通过现有任务API写入独立验证任务的`result.workflow_validation`：

```json
{
  "verdict": "PASS",
  "definition_sha256": "compose返回的精确指纹",
  "actor": "实际验证者",
  "activity_keys": ["所有实际验证过的活动key"],
  "evidence_refs": ["可回读的真实产出、运行或测试证据"]
}
```

失败写FAIL并保留证据。没有实际运行不得填PASS；输出质量需要人工判断时记录具体待判断项，不能由名称匹配推导成功。测试夹具证明机制，不证明客户业务已成功。

## 收尾和恢复

服务器返回`state.stage=completed`且`outputs.register.readback_verified=true`后，调用：

```text
node <本skill绝对路径>/scripts/client.mjs finish --task-id <task_id>
```

回读任务确为completed后输出短表：名称、版本、workflow_id、活动数、入口、验证证据。Notion投影状态未经回读不得声称已同步。发生阶段冲突、版本冲突、登记失败时输出具体阶段和服务器原因，保留同一任务及证据；不直接PATCH管理状态越过门禁、不编造ID或receipt。
