# Standard vs Autonomous 代码差异点 Inventory

> Phase 1 T1 产出。范围：Engine repo 下所有**纯 autonomous_mode 分支判断**（不含 harness_mode 分支，harness 保留）。
> 目标：删除 Standard 分支，统一为 "一种 /dev 默认 autonomous"。
>
> **搜索范围**：`/Users/administrator/perfect21/cecelia/packages/engine/`
> **搜索命令**：`grep -rn "autonomous_mode\|--autonomous\|autonomous_enabled\|AUTONOMOUS" --include="*.sh/.md/.ts/.cjs/.js/.yaml"`
> **原始 hit 总数**：64 条（12 个文件）

---

## 统计

| 类别 | 数量 | 含义 |
|------|------|------|
| **A 类（删）** | 4 条文件级 / 11 处片段 | 纯 autonomous true/false 分支判断，删除后代码简化 |
| **B 类（保留）** | 0 条 | 本 Phase 无 autonomous 相关的 harness_mode 交叉逻辑需保留 |
| **C 类（改文档）** | 9 条 | 文档中"三模式/Standard vs Autonomous"措辞需改为"一种 /dev 默认 autonomous" |
| **D 类（flag 兼容）** | 1 条 | `--autonomous` CLI flag 行为降级为 no-op + warn |
| **E 类（测试）** | 3 处文件 | 相应测试文件需要对应改 / 删除（附加类，归入 A 类范畴） |

> 备注：硬约束说"只看 autonomous_mode 相关，不管 harness_mode"。
> Engine repo 中 `autonomous_mode` 和 `harness_mode` **代码上并不交叉**（shell 两处独立 `grep` 分别读），
> 所以 B 类为空。但 `01-spec.md` §0 和 `02-code.md` §0 的"三选一模式判断"
> 同时包含两者 → 属于 **改造（非删除）**，已归入 A 类并注明"保留 harness 分支"。

---

## A 类详细（删 Standard 分支）

### A1. `packages/engine/skills/dev/scripts/parse-dev-args.sh:55-63`

**当前内容**：
```bash
# ============================================================================
# 如果有 TASK_ID 且未显式传 --autonomous，查询 Brain payload
# ============================================================================

if [[ -n "${TASK_ID}" ]] && [[ "${AUTONOMOUS_MODE}" == "false" ]]; then
    _brain_url="${BRAIN_API_URL:-http://localhost:5221}"
    _payload_auto=$(curl -s --connect-timeout 2 --max-time 4 \
        "${_brain_url}/api/brain/tasks/${TASK_ID}" 2>/dev/null | \
        jq -r '.payload.autonomous_mode // false' 2>/dev/null || echo "false")
    if [[ "${_payload_auto}" == "true" ]]; then
        AUTONOMOUS_MODE=true
    fi
fi
```

**删除原因**：
统一后 autonomous 永远是 `true`（默认）；不再需要 Brain payload 兜底查询。整块 if 判断可删除。

**删除后留什么**：
整段删除。AUTONOMOUS_MODE 在行 24 直接改为 `AUTONOMOUS_MODE=true`，无 flag 驱动分支。
（flag 处理仍保留在 D1 — 见下）

---

### A2. `packages/engine/skills/dev/steps/01-spec.md:25-39`（模式判断区）

**当前内容**：
```bash
## 0. 模式判断

检测 task payload 中的模式标志：

TASK_ID="<从 parse-dev-args.sh 获取>"
TASK_JSON=$(curl -s "http://localhost:5221/api/brain/tasks/${TASK_ID}")
HARNESS_MODE=$(echo "$TASK_JSON" | jq -r '.payload.harness_mode // false')
AUTONOMOUS_MODE=$(echo "$TASK_JSON" | jq -r '.payload.autonomous_mode // false')

- `harness_mode = true` → 跳转 **0.1**
- `autonomous_mode = true` → 跳转 **0.2**
- 两者均 false → 继续 **1.1（标准模式）**
```

**删除原因**：
Standard 分支（1.1 之后的"手动 Task Card"路径）整体删除。autonomous 变默认，harness 保留。

**删除后留什么**：
保留 harness_mode 判断，删掉 autonomous 判断 + "两者均 false" 分支；autonomous 的 §0.2.* 内容变成 §1（主路径）：

```bash
## 0. 模式判断（保留 harness）
HARNESS_MODE=$(...)
- `harness_mode = true` → 跳转 0.1（harness 分支）
- 其他 → 继续 §1（autonomous 默认流程）
```

---

### A3. `packages/engine/skills/dev/steps/01-spec.md:78-249`（§0.2 autonomous 分支整块）

**当前结构**：
- §0.2 `autonomous_mode = true 时（全自动：PRD → Plan，不问用户）`
- §0.2.HARD-GATE / §0.2.0 / §0.2.1 / §0.2.2 / §0.2.3 / §0.2.4 / §0.2.5 / §0.2.6

**删除原因 / 改造方向**：
**不删内容**，但**提升为主路径**。把"§0.2 autonomous_mode=true 时"改为"§1 主流程"，删除开头"v6.3.0 autonomous 分支变化"这类"为何分支"的解释文字。

**删除后留什么**：
- 删掉所有 `autonomous_mode = true 时` 句式，改为无条件
- 删掉行 78 小标题里的 "(全自动：PRD → Plan，不问用户)"（变多余）
- 删掉行 80-85 "v6.3.0 autonomous 分支变化" 历史说明段
- 删掉行 234 `.dev-mode` 里的 `autonomous_mode: true` 字段写入

---

### A4. `packages/engine/skills/dev/steps/01-spec.md:253`（`autonomous_mode = false` 标题 + §1.1-1.3 整段）

**当前内容**：
```
### autonomous_mode = false（默认，现有流程不变）

## 1.1 参数检测 + PRD 获取
...（主 agent 直接写 Task Card 的整个 standard 流程，行 253-347）
```

**删除原因**：
这就是"标准模式 主 agent 直写"的核心 Standard 分支，是 Phase 1 要干掉的东西。退化到几乎无人用，但还占了 ~95 行。

**删除后留什么**：
整块删除（行 253 到文件末尾"## 完成后"之前）。Autonomous 写 Task Card 的逻辑已在 §0.2.6 覆盖。`## 完成后` section（行 351-357）保留。

---

### A5. `packages/engine/skills/dev/steps/02-code.md:25-37`（模式判断区）

**当前内容**：
```bash
## 0. 模式判断（harness / autonomous / standard）

BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
HARNESS_MODE=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
AUTONOMOUS_MODE=$(grep "^autonomous_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")

- `harness_mode = true` → 走 **Section 1**
- `autonomous_mode = true` → 走 **Section 2**
- 其他 → 走 **Section 3**（standard）
```

**删除原因**：
与 A2 同理，三选一改二选一。

**删除后留什么**：
```bash
## 0. 模式判断（harness / 主路径）

HARNESS_MODE=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")

- `harness_mode = true` → 走 Section 1
- 其他 → 走 Section 2（主路径，Subagent 三角色）
```

§2 "autonomous_mode = true 时" 提升为主路径；§3 standard 整段删除。

---

### A6. `packages/engine/skills/dev/steps/02-code.md:62-271`（§2 autonomous + §3 standard）

**当前结构**：
- §2 autonomous_mode = true 时（Subagent 三角色全自动）— 行 62-271
- §3 standard mode（默认流程）— 行 275-331

**删除原因**：
§3 是 Standard 主 agent 直写分支（§3.1 探索 / §3.2 写代码 / §3.3 逐条验证 / §3.4 标记完成），整块废掉。

**删除后留什么**：
- §2 autonomous 改名为"§2 主路径（Subagent 三角色）"
- §2.0 v9.3.0 autonomous 分支变化段（行 64-68）删除
- §2 内所有 "autonomous_mode=true 时" 字样删除
- §3 整段（行 275-331）删除

---

### A7. `packages/engine/skills/dev/steps/00.5-enrich.md:11-20`（激活条件）

**当前内容**：
```bash
> 仅 autonomous_mode=true 激活。粗糙 PRD 先派 Enrich Subagent 多轮自反思补全成完整 PRD，再进 Stage 1。

## 0. 激活条件

AUTONOMOUS_MODE=$(grep "^autonomous_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")

[[ "$AUTONOMOUS_MODE" != "true" ]] && exit 0  # 非 autonomous 跳过
```

**删除原因**：
统一后永远激活（或改以 "thin PRD" 为触发条件，不再以 autonomous_mode 为门）。

**删除后留什么**：
```bash
## 0. 激活条件

# 统一后 PRD Enrich 永远激活（除非 PRD 已丰满）。是否真正派 Enrich Subagent
# 由 §1 的 enrich-decide.sh 决定。
```

删掉 `AUTONOMOUS_MODE` 读取 + `exit 0` 跳过。

---

### A8. `packages/engine/skills/dev/steps/00.7-decision-query.md:22-27`（激活条件）

**当前内容**：
```bash
## 0. 激活条件

BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
AUTONOMOUS_MODE=$(grep "^autonomous_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
[[ "$AUTONOMOUS_MODE" != "true" ]] && exit 0
```

**删除原因**：
统一后永远激活，门禁去掉。（按 v1.1.0 重塑，这本来就改成了"Research Subagent 按需调用工具"，但门禁代码还在）

**删除后留什么**：
删除整段 AUTONOMOUS_MODE 读取 + exit 0。保留 `BRANCH_NAME` + `DEV_MODE_FILE`（后续要用）。

---

### A9. `packages/engine/skills/dev/steps/04-ship.md:135-157`（discard 路径 autonomous 分支）

**当前内容**：
```bash
if [[ "${_FINISH_ACTION:-}" == "discard" ]]; then
    BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
    AUTO=$(grep "^autonomous_mode:" ".dev-mode.${BRANCH_NAME}" 2>/dev/null | awk '{print $2}')
    ...
    if [[ "$AUTO" == "true" ]]; then
        # autonomous 下不读 stdin，直接 abort + Brain task
        echo "autonomous_mode: true → aborting discard，creating Brain task for human review"
        curl -s -X POST localhost:5221/api/brain/tasks ...
        exit 1
    else
        # 人工模式：typed-confirm
        echo "Type exactly 'discard' to confirm:"
        read -r CONFIRM
        [[ "$CONFIRM" != "discard" ]] && { echo "Aborted (confirmation mismatch)"; exit 1; }
    fi
fi
```

**删除原因**：
统一后 /dev 永远 autonomous，不再读 stdin。只保留 autonomous 分支（`abort + Brain task`），删 else。

**删除后留什么**：
```bash
if [[ "${_FINISH_ACTION:-}" == "discard" ]]; then
    BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
    echo "⚠️  This will permanently delete: branch + commits + worktree"
    echo "/dev 默认 autonomous → aborting discard, creating Brain task for human review"
    curl -s -X POST localhost:5221/api/brain/tasks ...
    exit 1
fi
```

删掉 `AUTO=$(grep ...)` 读取 + `if [[ "$AUTO" == "true" ]]; then ... else ... fi`，只留"abort + Brain task"分支。

---

### A10. `.dev-mode` 文件写入字段（01-spec.md:234）

**当前内容**：
```bash
cat > ".dev-mode.${BRANCH_NAME}" << EOF
dev
branch: ${BRANCH_NAME}
owner_session: ${CLAUDE_SESSION_ID:-unknown}
autonomous_mode: true
task_id: ${TASK_ID}
...
EOF
```

**删除原因**：
.dev-mode 不再需要写 autonomous_mode 字段（永远 true，无下游读取者需要区分）。

**删除后留什么**：
删掉 `autonomous_mode: true` 这一行；保留其他字段。
同时全局搜 `grep "^autonomous_mode:"` 的 7 处读取（已在 A7/A8/A9 中覆盖）都要一并清理。

---

### A11. 测试文件（测试策略）

**涉及文件**：
1. `packages/engine/tests/scripts/parse-dev-args-autonomous.test.ts`（整个文件，11 处 hit）
2. `packages/engine/tests/skills/decision-query-step.test.ts:9-11`（`仅 autonomous_mode 激活` 断言）
3. `packages/engine/tests/skills/research-proxy-integration.test.ts:67-77`（`SKILL.md autonomous_mode 强制加载 proxy` describe 块）

**处理方案**：

| 文件 | 动作 | 理由 |
|------|------|------|
| `parse-dev-args-autonomous.test.ts` | **改造**：保留"`--autonomous` flag 接受但行为降级" 测试（D1 配套）；删除"不传 --autonomous 默认 false"测试 | 配合 D1 flag 降级 |
| `decision-query-step.test.ts:9-11` | **删除** `仅 autonomous_mode 激活` test | 统一后无 mode 门禁 |
| `research-proxy-integration.test.ts:67-77` | **改造** `autonomous_mode 必须加载 proxy` → 改为 `/dev 默认加载 proxy` | 描述更新，逻辑保留 |

---

## B 类详细（保留）

**无**。本 Phase 所有 `autonomous_mode` 相关分支都要改或删，没有"纯 harness 保留的 autonomous 交叉"点。

`HARNESS_MODE` 的读取和判断（01-spec.md:32 / 02-code.md:30）要保留，但它们不是 autonomous 分支，不在本 inventory 范围。

---

## C 类详细（改文档措辞）

### C1. `packages/engine/skills/dev/SKILL.md:5`（description）

**当前**：
```
description: 统一开发工作流（4-Stage Pipeline）。代码变更必须走 /dev。支持 Harness v2.0 模式。支持 autonomous_mode 全自动模式。autonomous_mode 新增 Step 0.5 PRD Enrich 前置层 + autonomous-research-proxy 用户交互替换层。
```

**改成**：
```
description: 统一开发工作流（4-Stage Pipeline）。代码变更必须走 /dev。默认 Subagent 三角色 + Research Subagent 代 user 交互 + PRD Enrich 前置层。支持 Harness v2.0 模式（Brain 派发）。
```

---

### C2. `packages/engine/skills/dev/SKILL.md:6`（trigger）

**当前**：
```
trigger: /dev, --task-id <id>, --autonomous
```

**改成**：
```
trigger: /dev, --task-id <id>
```
（`--autonomous` flag 虽然保留 no-op，但不再在 trigger 暴露）

---

### C3. `packages/engine/skills/dev/SKILL.md:8-10`（changelog）

**当前**：
```yaml
- 7.2.0: autonomous_mode 强制加载 autonomous-research-proxy — Superpowers user 交互点全替换为 Research Subagent
- 7.1.0: autonomous_mode 新增 Step 0.5 PRD Enrich 前置层 — 粗 PRD 自动丰满
- 7.0.0: Superpowers 融入 — autonomous_mode 三角色架构
```

**改成**：保留历史条目作为记录，在前面新增 Phase 1 条目：
```yaml
- 8.0.0: Phase 1 — 模式统一，Standard 分支删除，/dev 默认 autonomous
- 7.2.0: ... （保留历史）
```

---

### C4. `packages/engine/skills/dev/SKILL.md:44`（章节标题）

**当前**：
```
## 流程（标准模式）
```

**改成**：整段 44-52 删除（§ Standard 流程图），上面的 `## 流程（autonomous_mode）` 改名为 `## 流程`。

---

### C5. `packages/engine/skills/dev/SKILL.md:54`（章节标题）

**当前**：
```
## 流程（autonomous_mode）
```

**改成**：
```
## 流程
```

顺带行 58 `Step 0.5: PRD Enrich (仅 autonomous_mode，粗 PRD 自动丰满)` 改成
`Step 0.5: PRD Enrich（粗 PRD 自动丰满）`。

---

### C6. `packages/engine/skills/dev/SKILL.md:84`（章节标题）

**当前**：
```
### 标准模式
```

**改成**：
```
### 主流程
```

section 内容（行 86-94）保留（是 Stop Hook 条件，不是 Standard 特有）。

---

### C7. `packages/engine/skills/dev/SKILL.md:129-152`（`## autonomous_mode（全自动模式）` 整段）

**当前**：整段介绍 autonomous_mode 是什么、怎么触发、流程、跳过/不跳过清单。

**改成**：
- 章节标题 `## autonomous_mode（全自动模式）` → `## 主流程细节`
- 行 131 "触发: /dev --autonomous 或 Brain task payload autonomous_mode: true" → 删除
- "加载顺序"段里 `/dev --autonomous` → `/dev`
- "适用场景: PRD 已给..." → 改为"所有 /dev 场景"

---

### C8. `packages/engine/skills/dev/steps/autonomous-research-proxy.md:11`

**当前**：
```
> **autonomous_mode=true 时必须加载到系统 context**
```

**改成**：
```
> **/dev 启动时必须加载到系统 context**
```

---

### C9. `packages/engine/feature-registry.yml`（3 条 changelog 条目）

**涉及行**：
- `120` — v14.13.0 Decision-Driven Autonomous Layer
- `146` — v14.10.0 autonomous_mode 新增 Step 0.5 PRD Enrich
- `170` — v14.8.0 autonomous_mode 融合

**处理方案**：
历史 changelog **不改**（历史记录就该保留）。Phase 1 完成后**新增**一条 v14.18.0 描述模式统一即可。

（归类为 C 是因为描述提及了 "autonomous_mode 新增/融合"，但实际无需改动历史记录——仅列出供 T2/T3 决策。）

---

## D 类详细（flag 兼容）

### D1. `packages/engine/skills/dev/scripts/parse-dev-args.sh:40-43`（`--autonomous` flag 处理）

**当前内容**：
```bash
--autonomous)
    AUTONOMOUS_MODE=true
    shift
    ;;
```

**建议**：
保留 flag（向后兼容已有脚本/文档/CI），但行为降级为 no-op + warn：

```bash
--autonomous)
    echo "WARNING: --autonomous flag 已废弃，/dev 默认 autonomous 模式。此 flag 将在下个大版本移除。" >&2
    shift
    ;;
```

注释（行 10-11）同步更新：
```bash
#   --autonomous          已废弃 (no-op + warn)，/dev 默认 autonomous
```

输出字段 `AUTONOMOUS_MODE=true|false`（行 15, 70）的处理建议：
- **选项 A**（保守）：保留输出，固定写 `AUTONOMOUS_MODE=true`，不影响下游
- **选项 B**（激进）：删除输出字段，下游已改为不读

推荐 **选项 A**（T2 做 surgery 时更安全，T4 做回归更容易）。

---

## 关键改动 Top 5

1. **`packages/engine/skills/dev/steps/01-spec.md:253-347`** — 删除 "## 1.1 参数检测 / ## 1.2 写 Task Card / ## 1.3 写入 .dev-mode" 这 95 行 Standard 主流程（主 agent 直写分支）【A4】
2. **`packages/engine/skills/dev/steps/02-code.md:275-331`** — 删除 "## 3. standard mode" 整段（§3.1 探索 / §3.2 写代码 / §3.3 逐条验证 / §3.4 标记完成）【A6】
3. **`packages/engine/skills/dev/scripts/parse-dev-args.sh:55-63`** — 删除"Brain payload 兜底查询" if 块；行 24 `AUTONOMOUS_MODE=false` → `AUTONOMOUS_MODE=true`；flag 降级为 warn【A1 + D1】
4. **`packages/engine/skills/dev/steps/01-spec.md:25-39` + `02-code.md:25-37`** — 模式判断区从 "三选一（harness/autonomous/standard）" 改为 "二选一（harness/主路径）"，删掉 autonomous 读取行【A2 + A5】
5. **`packages/engine/skills/dev/SKILL.md:44-62`** — 把"## 流程（标准模式）"整个 8 行流程图段删除，"## 流程（autonomous_mode）" 改名"## 流程"【C4 + C5】

---

## 最意外的发现

1. **Engine shell 代码层（`lib/`、`hooks/`、`devloop-check.sh`）完全没有 autonomous 读取**。所有 mode 分支都集中在 `skills/dev/steps/*.md`（6 个）和 `skills/dev/scripts/parse-dev-args.sh`（1 个）。**Phase 1 surgery 面积小于预期**——不用碰 devloop-check.sh / hooks，只改 `steps/` + `parse-dev-args.sh`。
2. **Standard 分支其实是"主 agent 直写 Task Card + 主 agent 直接写代码"**，和 autonomous 的"Subagent 三角色"完全不同的执行模型。用户说 Standard"退化几乎无人用"——代码上确实没有 Brain payload 或 flag 把它"默认路由"到，只剩"不传 --autonomous 且 task payload 无 autonomous_mode"才走。
3. **Step 0.7 已在 v1.1.0 重塑为"Research Subagent 可选查询工具"**，但门禁代码（`[[ "$AUTONOMOUS_MODE" != "true" ]] && exit 0`）没清理干净——这是 Phase 1 顺手修复的副产品。
4. **04-ship.md §4.3 discard 路径**是 `autonomous_mode` 读取的第 7 个位置，容易被漏（grep 范围之外的人会以为只有 steps/ 前三个文件涉及）。

---

## 统计兜底表（涉及的文件全清单）

| 文件 | Hit 数 | 分类 |
|------|--------|------|
| `feature-registry.yml` | 3 | C9（历史记录，不改） |
| `skills/dev/SKILL.md` | 10 | C1-C7 + 顺带 |
| `skills/dev/scripts/parse-dev-args.sh` | 10 | A1 + D1 |
| `skills/dev/steps/01-spec.md` | 7 | A2 + A3 + A4 + A10 |
| `skills/dev/steps/02-code.md` | 5 | A5 + A6 |
| `skills/dev/steps/00.5-enrich.md` | 5 | A7 |
| `skills/dev/steps/00.7-decision-query.md` | 5 | A8 |
| `skills/dev/steps/04-ship.md` | 2 | A9 |
| `skills/dev/steps/autonomous-research-proxy.md` | 1 | C8 |
| `tests/scripts/parse-dev-args-autonomous.test.ts` | 11 | A11 |
| `tests/skills/decision-query-step.test.ts` | 2 | A11 |
| `tests/skills/research-proxy-integration.test.ts` | 3 | A11 |
| **合计** | **64** | |
