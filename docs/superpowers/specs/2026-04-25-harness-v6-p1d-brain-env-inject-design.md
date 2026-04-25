# Harness v6 P1-D — Brain↔Generator Prompt Env 协议固化

日期：2026-04-25
分支：cp-0425185121-harness-v6-p1d-brain-env-inject
Brain 任务：baa16433-91d0-4628-b078-08757d22bd44

## 背景

今晚 Gen2 (3329655d) 自我 ABORTED：Generator SKILL 严格自检 `CONTRACT_BRANCH`/`SPRINT_DIR`/`BRAIN_URL` 都没注入容器；同时 git remote 用宿主路径 (`/Users/.../perfect21/cecelia`)，容器内不可达；Brain 5221 走 `localhost` 容器内也不可达。

## 目标

把 Brain → Generator 容器的 prompt env 协议**固化**：让 dispatch 一定注入 5 个关键 env，让 entrypoint 自动重写宿主 git remote，让 SKILL 自检覆盖到位。

## 文件改动

| 文件 | 改动 |
|---|---|
| `packages/brain/src/harness-task-dispatch.js` | env 注入 5 个新变量 |
| `docker/cecelia-runner/entrypoint.sh` | git remote 自动重写为 https |
| `packages/workflows/skills/harness-generator/SKILL.md` | Step 0 自检列表新增 BRAIN_URL/WORKSTREAM_INDEX |
| `packages/brain/src/__tests__/harness-task-dispatch.test.js` | 新增 5 个断言（覆盖 env 注入 + WORKSTREAM_INDEX 提取） |
| `docs/learnings/cp-0425185121-harness-v6-p1d-brain-env-inject.md` | 根本原因 + 下次预防 |

## 协议定义

dispatch 必注入容器 env：

| Env | 来源 | 缺省 |
|---|---|---|
| `CONTRACT_BRANCH` | `payload.contract_branch` | 空串（warn 但不阻塞） |
| `SPRINT_DIR` | `payload.sprint_dir` | `sprints` |
| `BRAIN_URL` | 固定 `http://host.docker.internal:5221` | — |
| `WORKSTREAM_INDEX` | `payload.workstream_index`，否则从 `payload.logical_task_id`（`ws1` → `1`）提取 | 空串 |
| `WORKSTREAM_COUNT` | `payload.workstream_count` | 空串 |
| `PLANNER_BRANCH` | `payload.planner_branch` | 空串 |

WORKSTREAM_INDEX 提取规则：
- `payload.workstream_index` 是数字 → 转 string
- `payload.logical_task_id` 形如 `ws<N>` → 取 `<N>`
- 都不匹配 → 空串

## entrypoint.sh git remote 重写

新增逻辑（在 `git config --global --add safe.directory '*'` 之后）：

```bash
# 7. 容器内 git remote 自动重写：detached worktree 复制宿主 .git/config
# 时 origin URL 是宿主绝对路径（/Users/...），容器内不可达，必须改为 https。
if [[ -d /workspace/.git || -f /workspace/.git ]]; then
  REMOTE_URL=$(cd /workspace && git remote get-url origin 2>/dev/null || echo "")
  if [[ "$REMOTE_URL" =~ ^/ ]]; then
    cd /workspace && git remote set-url origin "https://github.com/perfectuser21/cecelia.git"
    echo "[entrypoint] git remote rewritten: $REMOTE_URL → https://github.com/perfectuser21/cecelia.git"
  fi
fi
```

## SKILL.md 改动

Step 0「解析任务上下文」自检从 2 项扩到 4 项：

```
TASK_ID / SPRINT_DIR / CONTRACT_BRANCH / BRAIN_URL / WORKSTREAM_INDEX 任一未定义时绝对禁止继续。
```

新增 Step 0.4「git remote 验证」：

```bash
# entrypoint.sh 已自动重写 origin URL，但保险起见自检
ORIGIN_URL=$(git remote get-url origin)
if [[ "$ORIGIN_URL" =~ ^/ ]]; then
  echo "ERROR: git remote 仍是宿主路径 $ORIGIN_URL — entrypoint 重写失败"
  exit 1
fi
```

## 测试

`packages/brain/src/__tests__/harness-task-dispatch.test.js` 新增 describe block `Harness v6 P1-D: env protocol`：

1. `injects CONTRACT_BRANCH/SPRINT_DIR/BRAIN_URL into container env`
2. `extracts WORKSTREAM_INDEX from payload.workstream_index (number)`
3. `extracts WORKSTREAM_INDEX from payload.logical_task_id (ws1 → 1)`
4. `defaults SPRINT_DIR to "sprints" when payload omits it`
5. `BRAIN_URL is fixed to host.docker.internal:5221`

## 成功标准

- [ARTIFACT] `harness-task-dispatch.js` env 含 `CONTRACT_BRANCH`/`SPRINT_DIR`/`BRAIN_URL`/`WORKSTREAM_INDEX`/`WORKSTREAM_COUNT`/`PLANNER_BRANCH`
- [BEHAVIOR] 单测覆盖 env 注入正确性（5 个断言全绿）
- [BEHAVIOR] entrypoint.sh 含 git remote 宿主路径检测 + 重写逻辑

## 约束

Brain 核心代码本地 /dev，harness_mode=false，foreground 阻塞 CI。

## 风险与回滚

风险：env 名跟容器内 SKILL 自检名不匹配 → Generator ABORTED。
缓解：SKILL.md 同步改 + 单测断言绑定 env 名。
回滚：revert PR 即可，不动 schema。
