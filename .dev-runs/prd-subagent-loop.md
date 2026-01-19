# PRD: Step 5-7 Subagent Loop 实现

## 问题

当前 Step 5-7 (写代码 → 写测试 → 质检) 没有自动化控制：
- 全靠 Claude 自己判断是否需要重试
- 没有 loop 计数
- 质检可以跳过或敷衍
- 报告里看不到具体做了什么
- 主 Agent 可以绕过 subagent 直接执行

## 目标

1. **强制** Step 5-7 由 Subagent 执行（Hook 层面阻止主 Agent 直接写代码）
2. Subagent 有 SubagentStop Hook 强制检查质检结果
3. 质检失败自动重试，有 loop 计数
4. 报告显示完整的质检详情和 loop 次数

## 架构设计

```
主 Agent
    │
    ├── Step 1-4: 直接执行
    │
    ├── Step 5-7: 调用 run-dev-loop.sh ─────────────────┐
    │       │                                           │
    │       │   参数:                                   │
    │       │   - branch_name                           │
    │       │   - max_loops (默认 3)                    │
    │       │   - timeout (默认 10 分钟)                │
    │       │                                           │
    │       ▼                                           │
    │   ┌─────────────────────────────────────────┐    │
    │   │  run-dev-loop.sh                        │    │
    │   │                                         │    │
    │   │  loop_count = 0                         │    │
    │   │  while loop_count < max_loops:          │    │
    │   │      │                                  │    │
    │   │      ▼                                  │    │
    │   │  启动 Subagent (Task tool)              │    │
    │   │      │                                  │    │
    │   │      │  prompt:                         │    │
    │   │      │  "执行 Step 5-7，产出:           │    │
    │   │      │   - 代码修改                     │    │
    │   │      │   - 测试代码                     │    │
    │   │      │   - .quality-report.json"        │    │
    │   │      │                                  │    │
    │   │      ▼                                  │    │
    │   │  Subagent 执行...                       │    │
    │   │      │                                  │    │
    │   │      │  [Subagent Stop Hook]            │    │
    │   │      │  检查 .quality-report.json       │    │
    │   │      │  - 不存在: 阻止退出              │    │
    │   │      │  - overall != pass: 阻止退出     │    │
    │   │      │  - overall == pass: 允许退出     │    │
    │   │      │                                  │    │
    │   │      ▼                                  │    │
    │   │  Subagent 返回结果                      │    │
    │   │      │                                  │    │
    │   │      ├── 成功 (overall=pass)            │    │
    │   │      │   → break, 返回成功              │    │
    │   │      │                                  │    │
    │   │      ├── 失败 (overall!=pass)           │    │
    │   │      │   → loop_count++, 继续           │    │
    │   │      │                                  │    │
    │   │      └── 超时/异常                      │    │
    │   │          → loop_count++, 继续           │    │
    │   │                                         │    │
    │   │  if loop_count >= max_loops:            │    │
    │   │      返回失败，需要人工介入             │    │
    │   │                                         │    │
    │   └─────────────────────────────────────────┘    │
    │       │                                           │
    │       ▼                                           │
    │   结果: success/failure + loop_count              │
    │                                                   │
    ├── Step 8-11: 直接执行                             │
    │                                                   │
    └───────────────────────────────────────────────────┘
```

## 强制机制

### 1. Subagent Stop Hook (强制产出)

```bash
# hooks/subagent-quality-gate.sh
# 只在 Subagent 执行 Step 5-7 时激活

QUALITY_REPORT=".quality-report.json"

# 检查 1: 文件必须存在
if [[ ! -f "$QUALITY_REPORT" ]]; then
    echo "质检报告不存在，继续执行 Step 5-7"
    exit 1  # 阻止退出
fi

# 检查 2: 必须有具体内容
L1=$(jq -r '.layers.L1_automated.status' "$QUALITY_REPORT")
L2=$(jq -r '.layers.L2_verification.status' "$QUALITY_REPORT")
L3=$(jq -r '.layers.L3_acceptance.status' "$QUALITY_REPORT")
OVERALL=$(jq -r '.overall' "$QUALITY_REPORT")

if [[ "$OVERALL" != "pass" ]]; then
    echo "质检未通过 (L1=$L1, L2=$L2, L3=$L3)"
    echo "继续修复..."
    exit 1  # 阻止退出
fi

# 检查 3: 不能全是 skip
if [[ "$L1" == "skip" && "$L2" == "skip" && "$L3" == "skip" ]]; then
    echo "质检不能全部跳过"
    exit 1
fi

echo "质检通过，允许退出"
exit 0
```

### 2. 超时保护 (防止死循环)

```bash
# run-dev-loop.sh 中的超时控制

TIMEOUT=600  # 10 分钟
MAX_LOOPS=3

for ((i=1; i<=MAX_LOOPS; i++)); do
    echo "Loop $i/$MAX_LOOPS"

    # 带超时启动 subagent
    timeout $TIMEOUT claude --subagent \
        --hooks "./hooks/subagent-quality-gate.sh" \
        --prompt "执行 Step 5-7..."

    EXIT_CODE=$?

    if [[ $EXIT_CODE -eq 0 ]]; then
        echo "质检通过"
        echo $i > .loop-count
        exit 0
    elif [[ $EXIT_CODE -eq 124 ]]; then
        echo "超时，重试..."
    else
        echo "失败，重试..."
    fi
done

echo "达到最大重试次数，需要人工介入"
exit 1
```

### 3. 主 Agent 调用方式

```bash
# 主 Agent 在 Step 4 完成后调用
bash skills/dev/scripts/run-dev-loop.sh \
    --branch "$BRANCH_NAME" \
    --max-loops 3 \
    --timeout 600

if [[ $? -ne 0 ]]; then
    echo "Step 5-7 失败，需要人工介入"
    exit 1
fi

# 读取 loop 次数
LOOP_COUNT=$(cat .loop-count 2>/dev/null || echo "1")
git config branch."$BRANCH_NAME".loop_count "$LOOP_COUNT"
```

## 问题：Claude Code 能否这样调用 Subagent？

**需要确认的点：**

1. `claude --subagent` 是否存在这个命令？
2. Subagent 能否有独立的 hooks？
3. Task tool 启动的 agent 是否支持 Stop hook？

**备选方案（如果 CLI 不支持）：**

用 Task tool 直接启动，主 Agent 自己控制 loop：

```
主 Agent:
    for i in 1..3:
        result = Task(subagent_type="general-purpose",
                      prompt="执行 Step 5-7，必须产出 .quality-report.json")

        检查 .quality-report.json
        if overall == "pass":
            break
        else:
            继续 loop
```

这种方式：
- 不依赖 subagent stop hook
- 主 agent 自己检查结果
- 但依赖 subagent 诚实执行

## 强制机制（核心）

### branch-protect.sh 强制调用 subagent

```bash
# hooks/branch-protect.sh 新增逻辑

STEP=$(git config --get branch."$BRANCH".step 2>/dev/null || echo "0")

# Step 4-6 期间，必须通过 subagent 执行
if [[ "$STEP" -ge 4 && "$STEP" -lt 7 ]]; then
    # 检查是否有 subagent 锁文件
    if [[ ! -f ".subagent-lock" ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  Step 5-7 必须通过 Subagent 执行" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "  请使用 Task tool 启动 dev-loop subagent:" >&2
        echo "" >&2
        echo "  Task(" >&2
        echo "    subagent_type='general-purpose'," >&2
        echo "    prompt='执行 Step 5-7: 写代码、写测试、质检'" >&2
        echo "  )" >&2
        echo "" >&2
        exit 2  # 强制阻止
    fi
fi
```

### Subagent 工作流程

```
主 Agent (step=4)
    │
    ├── 尝试直接写代码
    │   → branch-protect.sh exit 2 阻止
    │   → "必须通过 subagent 执行"
    │
    ├── 被迫调用 Task tool
    │   │
    │   │  Task(
    │   │    subagent_type="general-purpose",
    │   │    prompt="
    │   │      1. 创建 .subagent-lock 文件
    │   │      2. 执行 Step 5: 写代码
    │   │      3. 执行 Step 6: 写测试
    │   │      4. 执行 Step 7: 质检
    │   │      5. 生成 .quality-report.json
    │   │      6. 如果质检通过，删除 .subagent-lock
    │   │    "
    │   │  )
    │   │
    │   ▼
    │   Subagent 启动
    │       │
    │       ├── 创建 .subagent-lock
    │       │   → branch-protect.sh 检测到锁，放行写代码
    │       │
    │       ├── 执行 Step 5-7
    │       │
    │       ├── SubagentStop Hook 检查
    │       │   │
    │       │   ├── .quality-report.json 存在 && pass
    │       │   │   → 删除 .subagent-lock
    │       │   │   → exit 0 允许退出
    │       │   │
    │       │   └── 否则
    │       │       → exit 2 阻止退出，继续修复
    │       │
    │       └── loop_count++ 记录到 git config
    │
    └── Subagent 返回，主 Agent 继续 Step 8
```

## 涉及文件

| 文件 | 操作 | 说明 |
|------|------|------|
| hooks/branch-protect.sh | 修改 | 新增 subagent 强制检查 |
| .claude/settings.json | 修改 | 新增 SubagentStop hook |
| hooks/subagent-quality-gate.sh | 新建 | Subagent Stop Hook |
| skills/dev/SKILL.md | 修改 | 更新流程说明 |
| skills/dev/steps/05-code.md | 修改 | 说明由 subagent 执行 |
| skills/dev/steps/06-test.md | 修改 | 说明由 subagent 执行 |
| skills/dev/steps/07-quality.md | 修改 | 说明由 subagent 执行 |
| skills/dev/scripts/generate-report.sh | 修改 | 添加 loop_count 和质检详情 |

## 成功标准

1. Step 5-7 由 Subagent 执行
2. 质检失败自动重试（最多 3 次）
3. 超时自动重试（最多 10 分钟/次）
4. 报告显示 loop 次数和每层质检详情
5. 达到 max_loops 后提示人工介入

## 待确认

1. Claude Code CLI 是否支持 `--subagent` 模式？
2. Task tool 的 subagent 是否支持独立 hooks？
3. 如果都不支持，是否用主 Agent 自己控制 loop（备选方案）？

## 优先级

**高** - 这是核心功能，没有这个质检就没有意义
