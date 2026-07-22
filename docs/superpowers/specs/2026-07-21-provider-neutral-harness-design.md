# Provider-Neutral Harness Kernel 设计

日期：2026-07-21
状态：主理人已在对话中确认方向并授权实施
范围：Cecelia 内部使用；跨设备、跨账号、跨供应商；不建设对外协议服务

## 1. 目标

把 Harness 从“一个 Claude/Codex controller session 自己解释接力规则”改为 Cecelia 内部的确定性接力 Kernel：

- Harness 阶段、对抗轮次、门禁、重试和恢复由代码决定；
- Claude Code、Codex、未来 Grok 等只负责执行某一棒；
- 同一份 Skill 和同一份任务合同可交给任意 Provider；
- Provider、账号、设备可以在棒与棒之间切换；
- 不要求调用方选择具体 model，默认由 Provider Adapter/账号配置选择；
- 不新增公开服务，复用 Brain、PostgreSQL、Docker、现有 callback 和跨机通道。

## 2. 现状与复用边界

仓库已有 `packages/brain/src/orchestrator/`，它已经实现：

- `derive.js`：planning → GAN → generate → evaluate → judge → merge 的纯函数路由；
- `loop.js`：reconcile loop、append-only intent、心跳和四态出口；
- `ground-truth.js`：从 Git/PR/DB/容器重新观测状态；
- `gates.js`：evaluate/judge/human review 硬门禁；
- `orchestrator_decision_log`：可回放决策链。

因此它就是本设计的 Harness Kernel，不再新建第二套状态机。

当前缺口是 `orchestrator/run.js` 的真实 `dispatch` 仍为 `NotImplemented`。线上 `harness-skill-relay.js` 绕过 Kernel，直接启动一个包含 `harness-controller` 全文的 Claude/Codex session；Codex runner 又没有使用结构化输出和原生 thread resume。这造成供应商语义泄漏、角色隔离无法证明、Skill 版本漂移和重启只能 fresh start。

## 3. 总体架构

```text
Brain Scheduler
  └─ 资源、设备、账号、Provider 选择
       ↓
Existing Harness Kernel (packages/brain/src/orchestrator)
  └─ 阶段、对抗、门禁、重试、恢复
       ↓
Harness Dispatcher
  ├─ 生成冻结的 TaskBundle
  ├─ 创建 harness_attempts
  └─ 调用 Provider Registry
       ↓
Provider Adapter
  ├─ Claude Code
  ├─ Codex
  └─ 后续 Grok/其他执行器
       ↓
Runner（本机、Docker 或跨机 Bridge）
  └─ 产出 HarnessResult + provider events
```

Brain 决定“谁、在哪执行”；Kernel 决定“下一棒是什么”；Skill 决定“这一棒怎么做”；模型只执行本棒。

## 4. 内部执行合同

合同只在 Cecelia 内部使用，但必须版本化和运行时校验。

### 4.1 TaskBundle

```json
{
  "contract_version": "1.0",
  "run_id": "uuid",
  "attempt_id": "uuid",
  "hop": 3,
  "phase": "gan",
  "role": "reviewer",
  "objective": "审核 r2 合同是否满足 sprint PRD",
  "skill": {
    "name": "harness-contract-reviewer",
    "version": "2.9.0",
    "digest": "sha256:...",
    "content": "..."
  },
  "inputs": {
    "task_id": "uuid",
    "sprint_dir": "sprints/...",
    "worktree_path": "/workspace",
    "artifacts": []
  },
  "constraints": {
    "read_only": true,
    "fresh_session": true,
    "timeout_seconds": 1800
  },
  "expected_output": "harness-result/reviewer-v1"
}
```

TaskBundle 禁止出现供应商原语，例如 `Task tool`、`Skill(...)`、`spawn_agent` 或某家 hook 名称。Adapter 可以把合同翻译成供应商 CLI 参数和 Prompt，但不得改变业务语义。

### 4.2 HarnessResult

```json
{
  "contract_version": "1.0",
  "attempt_id": "uuid",
  "status": "completed",
  "summary": "合同需要修订",
  "artifacts": [],
  "checks": [],
  "decision": {
    "outcome": "changes_requested",
    "reason": "缺少恢复验收"
  },
  "error": null,
  "provider_metadata": {
    "provider": "codex",
    "session_id": "opaque"
  }
}
```

状态枚举为 `completed | completed_with_concerns | needs_context | blocked | failed | cancelled`。Adapter 把它映射为 Kernel 已有的 `DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`；`failed/cancelled` 进入明确错误路径。

### 4.3 Event

最小事件集为 `attempt.started`、`attempt.heartbeat`、`attempt.progress`、`artifact.created`、`attempt.completed`、`attempt.failed`、`attempt.cancelled`。原始 stdout/JSONL 只用于取证，不能再靠 grep 自然语言判断成败。

## 5. 对抗式隔离不变量

Provider-neutral 不等于取消对抗。Kernel 必须强制以下不变量：

1. proposer、reviewer、generator、evaluator、judge 各自对应独立 attempt；
2. proposer 与 reviewer 的 `provider_session_id` 不得相同；
3. reviewer 只接收冻结的 PRD、合同产物和审查 rubric，不继承 proposer 对话历史；
4. 同一 Provider 可以承担相邻角色，但必须新建 session；
5. resume 只允许恢复同一个 attempt，禁止跨角色 resume；
6. reviewer `changes_requested` 必须由 Kernel 路由回 proposer；
7. evaluator PASS 后仍必须进入独立 judge，双 PASS 才能 merge；
8. 这些规则写成代码校验和测试，不能只存在于 Skill 文案。

## 6. Skill 冻结

每个 attempt 派发前由 `skill-bundle` 解析 Skill，并记录 `name + version + sha256 digest + content`。

默认 SSOT 是当前工作树的 `packages/workflows/skills/<name>/SKILL.md`；可通过显式内部配置覆盖根目录，但禁止优先扫描某个供应商的 home。一次 attempt 创建后内容不可变；同一 run 后续 attempt 可以继续复用 run 固定的 digest，避免 v2.7/v2.9 混跑。

执行器不依赖供应商原生 Skill 安装。Claude/Codex/Grok 都直接收到同一个已解析 Skill bundle。

## 7. Attempt 持久化

新增内部表 `harness_attempts`：

- `id, run_id, hop, phase, role`；
- `provider, account_id, machine_id`；
- `skill_name, skill_version, skill_digest`；
- `task_bundle, result` JSONB；
- `status, provider_session_id`；
- `lease_owner, lease_expires_at, heartbeat_at`；
- `started_at, completed_at, error_code, error_message`；
- `UNIQUE(run_id, hop)` 保证一次 intent 只创建一个 attempt。

跨设备 worker 只需领取 attempt、续租并回写结果。租约过期后 Brain 可以重新分配；如果 Adapter 支持 resume 且 session 可达，则恢复同 attempt，否则关闭旧 attempt 并为同一 Kernel 动作创建新的 retry attempt。

## 8. Provider Adapter

统一接口：

```js
start({ bundle, execution })
resume({ attempt, input })
inspect({ attempt })
cancel({ attempt })
normalizeResult({ attempt, raw })
```

Adapter 能力通过 registry 声明：`structured_output`、`resume`、`stream_events`、`local_cli`、`remote_bridge`。Kernel 不按供应商名称分支，只按能力和执行结果分支。

### Claude Code

- 使用现有容器凭据和 `claude -p --output-format json`；
- fresh role 不传 resume；同 attempt 恢复才传供应商 session id；
- 结构化结果写统一 result 文件；Claude hook 只作为事件来源，不再决定 Harness 流程。

### Codex

- 使用 `codex exec --json --output-schema <schema> --output-last-message <file>`；
- 从 `thread.started` 保存 thread id；
- 同 attempt 恢复使用 `codex exec resume <thread_id>`；
- proposer/reviewer 等跨角色强制 fresh thread；
- 不指定 model 时沿用对应 `CODEX_HOME/config.toml`，满足“不挑 model”。

### 后续 Provider

Grok 或其他执行器只需新增 Adapter 并通过合同测试，不修改 Kernel、Skill 或阶段路由。

## 9. 启动、回调与恢复

- `harness-skill-relay` 增加 Kernel 路径，先创建/复用 `initiative_runs`，再拉起现有 `orchestrator/run.js`；
- 旧 `skill-relay` controller 路径保留 feature flag 作为回滚通道；
- runner 回调改为现有 Brain 下的内部 attempt callback，不建设新服务；
- watchdog 优先检查 `harness_attempts` 的租约、心跳和 session id，不再只按容器消失 fresh start；
- 原生 resume 失败时才基于 Git/PR/DB 外部真相新建 retry attempt。

## 10. 错误处理

- 合同或结果 schema 非法：`contract_violation`，不得伪装 completed；
- Skill digest 不一致：拒绝执行；
- Provider 不可用：重新选择满足能力的 Adapter；
- 认证/额度问题：换账号，不改变 Skill 和角色；
- 两次相同 `BLOCKED/NEEDS_CONTEXT`：沿用 Kernel 既有熔断；
- reviewer/evaluator/judge 缺结构化 verdict：视为失败，不从自然语言猜测；
- callback 重复：依靠 attempt id + 终态条件幂等忽略。

## 11. 迁移顺序

1. 增加合同、Skill bundle、attempt 表和 Provider Registry，保持现网零行为变化；
2. 完成 Claude/Codex adapters 与定向合同测试；
3. 补齐现有 orchestrator T3 dispatcher；
4. 用 feature flag 接入 Kernel 路径，跑 dry-run 和小型真实 Harness；
5. 对比旧 controller 路径后，将 Kernel 设为默认；
6. 稳定后删除 `harness-controller` 中供应商专用的 Task/Skill 调度职责。

## 12. 验收标准

- 相同 TaskBundle 可由 Claude 和 Codex 执行并返回同 schema；
- proposer/reviewer 的 attempt 和 session 均独立；
- Codex thread id 被保存，同 attempt 能 resume；
- Skill version/digest 在 run 内稳定；
- 切换账号、设备或 Provider 后能从结构化状态继续；
- evaluator + judge 双门禁无法绕过；
- 旧 skill-relay 路径可回滚；
- 新增模块全部有先红后绿的定向单测，现有 orchestrator 定向测试保持通过。

## 13. 范围外

- 对外公开 Harness 协议或 SDK；
- 新建独立 MCP/HTTP 服务；
- 在本阶段实现真实 Grok Adapter（先冻结接口和认证测试）；
- 替用户选择或硬编码具体模型；
- 顺手修复与本任务无关的全量 Brain 基线端口/OOM 问题。

## 14. CodeQL 跟进：Attempt Callback 限流

新 attempt callback 的 heartbeat 与终态写入路由必须在访问数据库前经过独立限流器：heartbeat 每个 `attemptId` 每分钟最多 30 次，terminal callback 每个 `attemptId` 每分钟最多 10 次。两者分开计数，避免频繁心跳耗尽终态回调额度；合法成功请求不消耗失败预算，使 runner 的正常心跳及幂等重试不被误伤。

实现使用 `express-rate-limit` 的进程内 MemoryStore，返回标准 `RateLimit`/`Retry-After` 头和 JSON 429。按高熵 UUID attempt id 分桶，使同宿主并行 initiative 互不影响；无效、未认证、租约错误或 schema 错误请求会累计并触发限流。Brain 当前是单进程，分布式共享计数器不在本修复范围。

验收要求：两个路由分别有先红后绿的 429 回归测试；既有认证、lease fence、callback 幂等和 kernel 集成测试保持通过；CodeQL 的两条 `Missing rate limiting` 告警在新提交重扫后消失。
