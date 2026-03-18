---
name: intent-expand
version: 1.0.0
created: 2026-03-18
updated: 2026-03-18
description: |
  意图扩展 skill。Brain 派发 intent_expand 任务时调用。
  沿 Task → Project → KR → OKR → Vision 层级链条查询，
  将层级上下文与原始 PRD 合并，生成 enriched PRD。

  输入：BRAIN_TASK_ID（当前 intent_expand 任务ID）、PARENT_TASK_ID（触发方任务ID）
  输出：.enriched-prd-<branch>.md 文件 + stdout 打印 ENRICHED_PRD_RESULT: SUCCESS

trigger_words:
  - intent_expand（由 Brain executor 自动调用，不由用户手动触发）
---

# /intent-expand — 意图扩展 Skill

**角色**：意图扩展引擎（自动调用，非用户入口）

**调用方**：Brain executor（当 task_type = intent_expand 时）

---

## 核心定位

`intent-expand` 是 Brain 两阶段前置审查的第一阶段。在正式开发（/dev）之前，此 skill 将用户简短描述的 PRD 扩展为完整的、带层级上下文的 enriched PRD。

**层级链条**：
```
Brain Task（intent_expand）
  └── parent Task（用户描述的待开发任务）
        └── Project（项目）
              └── KR（关键结果）
                    └── OKR（季度目标）
                          └── Vision（系统愿景）
```

---

## 环境变量

执行时由 Brain executor 注入：

| 变量 | 说明 | 示例 |
|------|------|------|
| `BRAIN_TASK_ID` | 当前 intent_expand 任务 ID | `abc-123` |
| `PARENT_TASK_ID` | 触发方父任务 ID | `xyz-456` |
| `BRAIN_URL` | Brain API 地址（默认 http://localhost:5221） | `http://localhost:5221` |

---

## 执行流程

### Step 1: 读取父任务信息

```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PARENT_TASK_ID="${PARENT_TASK_ID:-}"

if [[ -z "$PARENT_TASK_ID" ]]; then
  echo "[intent-expand] 错误：PARENT_TASK_ID 未设置" >&2
  exit 1
fi

echo "[intent-expand] Step 1: 读取父任务 $PARENT_TASK_ID..."

PARENT_TASK=$(curl -s "${BRAIN_URL}/api/brain/tasks/${PARENT_TASK_ID}")

PARENT_TITLE=$(echo "$PARENT_TASK" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('title','（无标题）'))")
PARENT_DESC=$(echo "$PARENT_TASK" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('description','（无描述）'))")
PROJECT_ID=$(echo "$PARENT_TASK" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('project_id') or '')")

echo "[intent-expand] 父任务标题: $PARENT_TITLE"
echo "[intent-expand] project_id: ${PROJECT_ID:-(无)}"
```

### Step 2: 查询层级上下文

```bash
echo "[intent-expand] Step 2: 查询层级上下文..."

PROJECT_TITLE=""
PROJECT_DESC=""
KR_TITLE=""
KR_DESC=""
OKR_TITLE=""
OKR_DESC=""
VISION_TITLE=""
VISION_DESC=""

# 2a. 查询 Project
if [[ -n "$PROJECT_ID" ]]; then
  PROJECT=$(curl -s "${BRAIN_URL}/api/brain/projects/${PROJECT_ID}")
  PROJECT_TITLE=$(echo "$PROJECT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('name',''))")
  PROJECT_DESC=$(echo "$PROJECT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('description') or '')")
  KR_ID=$(echo "$PROJECT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('kr_id') or '')")
  echo "[intent-expand] Project: $PROJECT_TITLE"

  # 2b. 查询 KR（goals 表）
  if [[ -n "$KR_ID" ]]; then
    KR=$(curl -s "${BRAIN_URL}/api/brain/goals/${KR_ID}")
    KR_TITLE=$(echo "$KR" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('title',''))")
    KR_DESC=$(echo "$KR" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('description') or '')")
    OKR_ID=$(echo "$KR" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('parent_id') or '')")
    echo "[intent-expand] KR: $KR_TITLE"

    # 2c. 查询 OKR
    if [[ -n "$OKR_ID" ]]; then
      OKR=$(curl -s "${BRAIN_URL}/api/brain/goals/${OKR_ID}")
      OKR_TITLE=$(echo "$OKR" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('title',''))")
      OKR_DESC=$(echo "$OKR" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('description') or '')")
      VISION_ID=$(echo "$OKR" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('parent_id') or '')")
      echo "[intent-expand] OKR: $OKR_TITLE"

      # 2d. 查询 Vision
      if [[ -n "$VISION_ID" ]]; then
        VISION=$(curl -s "${BRAIN_URL}/api/brain/goals/${VISION_ID}")
        VISION_TITLE=$(echo "$VISION" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('title',''))")
        VISION_DESC=$(echo "$VISION" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('description') or '')")
        echo "[intent-expand] Vision: $VISION_TITLE"
      fi
    fi
  fi
fi
```

### Step 3: 生成 enriched PRD

```bash
echo "[intent-expand] Step 3: 生成 enriched PRD..."

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
OUTPUT_FILE=".enriched-prd-${BRANCH}.md"

# 构建层级上下文文本
HAS_CONTEXT=false
CONTEXT_SECTION=""

if [[ -n "$VISION_TITLE" ]]; then
  CONTEXT_SECTION+="**Vision**: ${VISION_TITLE}\\n"
  [[ -n "$VISION_DESC" ]] && CONTEXT_SECTION+="${VISION_DESC}\\n"
  CONTEXT_SECTION+="\\n"
  HAS_CONTEXT=true
fi

if [[ -n "$OKR_TITLE" ]]; then
  CONTEXT_SECTION+="**OKR（季度目标）**: ${OKR_TITLE}\\n"
  [[ -n "$OKR_DESC" ]] && CONTEXT_SECTION+="${OKR_DESC}\\n"
  CONTEXT_SECTION+="\\n"
  HAS_CONTEXT=true
fi

if [[ -n "$KR_TITLE" ]]; then
  CONTEXT_SECTION+="**KR（关键结果）**: ${KR_TITLE}\\n"
  [[ -n "$KR_DESC" ]] && CONTEXT_SECTION+="${KR_DESC}\\n"
  CONTEXT_SECTION+="\\n"
  HAS_CONTEXT=true
fi

if [[ -n "$PROJECT_TITLE" ]]; then
  CONTEXT_SECTION+="**Project（项目）**: ${PROJECT_TITLE}\\n"
  [[ -n "$PROJECT_DESC" ]] && CONTEXT_SECTION+="${PROJECT_DESC}\\n"
  CONTEXT_SECTION+="\\n"
  HAS_CONTEXT=true
fi

if [[ "$HAS_CONTEXT" == "false" ]]; then
  CONTEXT_SECTION="（此任务未关联项目/KR/OKR/Vision，无法获取层级上下文）\\n"
fi

# 写入 enriched PRD 文件
python3 - <<PYEOF
import os, datetime

branch = os.popen("git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown").read().strip()
output_file = f".enriched-prd-{branch}.md"
parent_title = """${PARENT_TITLE}"""
parent_desc = """${PARENT_DESC}"""
context_section = """${CONTEXT_SECTION}"""
now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

content = f"""# Enriched PRD: {parent_title}

> 由 /intent-expand skill 自动生成 | {now}
> 任务 ID: ${BRAIN_TASK_ID:-unknown}

---

## 意图上下文

{context_section.replace('\\\\n', chr(10))}
---

## 补全后的需求

基于以上层级上下文，本任务的完整意图为：

- **战略对齐**：{parent_title} 是对上述 KR/OKR 目标的具体落实
- **核心需求**：{parent_desc[:200] if len(parent_desc) > 200 else parent_desc}
- **优先级依据**：与 KR 直接关联，优先级高

---

## 原始 PRD

{parent_desc}
"""

with open(output_file, 'w', encoding='utf-8') as f:
    f.write(content)

print(f"[intent-expand] enriched PRD 已写入: {output_file}")
PYEOF
```

### Step 4: 输出结果

```bash
echo "[intent-expand] Step 4: 输出结果..."

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
OUTPUT_FILE=".enriched-prd-${BRANCH}.md"

if [[ -f "$OUTPUT_FILE" ]]; then
  echo "ENRICHED_PRD_RESULT: SUCCESS"
  echo "ENRICHED_PRD_FILE: ${OUTPUT_FILE}"
  echo "[intent-expand] 完成。enriched PRD 已保存至 ${OUTPUT_FILE}"
else
  echo "ENRICHED_PRD_RESULT: FAILED"
  echo "[intent-expand] 错误：enriched PRD 文件未生成" >&2
  exit 1
fi
```

---

## 完整执行脚本

将以上 Step 1-4 串联，实际执行时运行以下完整脚本：

```bash
#!/usr/bin/env bash
# intent-expand.sh — 意图扩展完整执行脚本
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
BRAIN_TASK_ID="${BRAIN_TASK_ID:-}"
PARENT_TASK_ID="${PARENT_TASK_ID:-}"

echo "[intent-expand] 开始执行..."
echo "[intent-expand] BRAIN_TASK_ID: ${BRAIN_TASK_ID}"
echo "[intent-expand] PARENT_TASK_ID: ${PARENT_TASK_ID}"

# Step 1: 读取父任务
# （见上方 Step 1）

# Step 2: 查询层级
# （见上方 Step 2）

# Step 3: 生成 enriched PRD
# （见上方 Step 3）

# Step 4: 输出结果
# （见上方 Step 4）
```

---

## 降级策略

| 情况 | 处理方式 |
|------|---------|
| `project_id` 为空 | 跳过层级查询，仍生成 enriched PRD（只含原始 PRD） |
| `kr_id` 为空 | 跳过 KR/OKR/Vision 查询 |
| `parent_id` 为空 | 跳过上层查询 |
| API 返回错误 | 记录警告，继续生成（不因部分缺失而失败） |

---

## 输出格式示例

```markdown
# Enriched PRD: 修复 Brain tick 延迟问题

> 由 /intent-expand skill 自动生成 | 2026-03-18 20:00

---

## 意图上下文

**Vision**: Cecelia 从人工维护转变为自主运转平台，不再需要人肉值守

**OKR（季度目标）**: 提升系统自动化程度和可靠性

**KR（关键结果）**: KR2: 系统响应延迟从平均 500ms 降至 < 100ms

**Project（项目）**: 任务韧性 — blocked 状态 + 错误上报 + 自修复循环

---

## 补全后的需求

基于以上层级上下文，本任务的完整意图为：

- **战略对齐**：修复 Brain tick 延迟问题 是对上述 KR 目标的具体落实
- **核心需求**：Brain tick loop 出现延迟，影响任务调度效率
- **优先级依据**：与 KR 直接关联，优先级高

---

## 原始 PRD

Brain tick 有时候会延迟超过 10s，需要排查原因并修复。
```

---

## 注意事项

- 此 skill 为**只读**操作：只查询 Brain API，不修改任何数据库记录
- 生成的 `.enriched-prd-<branch>.md` 文件供后续 `/cto-review` 和 `/dev` 使用
- `ENRICHED_PRD_RESULT: SUCCESS` 是 Brain executor 解析的关键标志，必须准确输出
- 层级查询使用实际存在的 Brain API 端点：
  - `GET /api/brain/tasks/:id`
  - `GET /api/brain/projects/:id`
  - `GET /api/brain/goals/:id`
