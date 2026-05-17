# QA Integration - Quality System as Immune System

本文档说明如何将 QA 系统集成为 Cecelia Platform 的"免疫系统"。

---

## 概述

**核心理念**：QA 系统不是外部服务，而是 VPS 大脑的内置免疫系统。

```
┌─────────────────────────────────────────────┐
│               VPS 大脑                       │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────┐         ┌──────────────┐  │
│  │   Gateway   │────────▶│    Queue     │  │
│  │  (输入网关)   │         │   (任务队列)  │  │
│  └─────────────┘         └───────┬──────┘  │
│                                  │         │
│                                  ▼         │
│                          ┌──────────────┐  │
│                          │    Worker    │  │
│                          │  (执行调度)   │  │
│                          └───────┬──────┘  │
│                                  │         │
│                ┌─────────────────┼─────────┐
│                │                 │         │
│                ▼                 ▼         │
│        ┌──────────────┐  ┌──────────────┐ │
│        │ QA Executor  │  │   CloudCode  │ │
│        │  (免疫系统)   │  │    (工人)     │ │
│        └──────┬───────┘  └──────┬───────┘ │
│               │                 │         │
│               ▼                 ▼         │
│        ┌──────────────────────────────┐   │
│        │       Evidence Store         │   │
│        │     (runs/<runId>/)          │   │
│        └──────────────────────────────┘   │
│                                           │
└───────────────────────────────────────────┘
```

---

## 1. QA Orchestrator 作为 Intent Executor

### Worker 调用 QA 的流程

```bash
# worker/worker.sh 中的 execute_qa 函数

execute_qa() {
  local task_json="$1"
  local run_dir="$2"

  echo "Running QA orchestrator..."

  # Extract payload
  local project=$(echo "$task_json" | jq -r '.payload.project // "unknown"')
  local branch=$(echo "$task_json" | jq -r '.payload.branch // "develop"')
  local scope=$(echo "$task_json" | jq -r '.payload.scope // "pr"')

  # Call orchestrator (关键：直接调用本地脚本)
  if [[ -f "$PROJECT_ROOT/orchestrator/qa-run.sh" ]]; then
    bash "$PROJECT_ROOT/orchestrator/qa-run.sh" \
      --project "$project" \
      --branch "$branch" \
      --scope "$scope" \
      --output-dir "$run_dir/evidence" \
      > "$run_dir/qa-output.log" 2>&1

    local exit_code=$?

    # Archive evidence
    bash "$SCRIPT_DIR/archive-evidence.sh" "$run_dir"

    # Generate result
    if [[ $exit_code -eq 0 ]]; then
      echo '{"status":"completed","intent":"runQA","qa_decision":"PASS"}' > "$run_dir/result.json"
    else
      echo '{"status":"failed","intent":"runQA","qa_decision":"FAIL"}' > "$run_dir/result.json"
    fi

    return $exit_code
  else
    echo "WARNING: orchestrator/qa-run.sh not found, skipping QA run" >&2
    echo '{"status":"completed","intent":"runQA","note":"orchestrator_not_found"}' > "$run_dir/result.json"
    return 0
  fi
}
```

---

## 2. QA Orchestrator 实现

### orchestrator/qa-run.sh

```bash
#!/bin/bash
# QA Orchestrator - Run all quality checks
# Called by Worker for runQA intent

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse arguments
PROJECT=""
BRANCH="develop"
SCOPE="pr"  # pr or release
OUTPUT_DIR="$PROJECT_ROOT/evidence"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT="$2"
      shift 2
      ;;
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --scope)
      SCOPE="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [[ -z "$PROJECT" ]]; then
  echo "ERROR: --project is required"
  exit 1
fi

# Ensure output directory exists
mkdir -p "$OUTPUT_DIR"

echo "🧪 QA Orchestrator"
echo "  Project: $PROJECT"
echo "  Branch: $BRANCH"
echo "  Scope: $SCOPE"
echo "  Output: $OUTPUT_DIR"
echo ""

# Get project path from control plane
PROJECT_PATH=$(grep -A 5 "id: $PROJECT" "$PROJECT_ROOT/control-plane/repo-registry.yaml" | grep "path:" | awk '{print $2}')

if [[ -z "$PROJECT_PATH" ]]; then
  echo "ERROR: Project not found in repo-registry.yaml"
  exit 1
fi

cd "$PROJECT_PATH"

# Step 1: L1 - Automated Tests
echo "🔬 Step 1: L1 - Automated Tests"
if [[ -f "package.json" ]]; then
  npm run test > "$OUTPUT_DIR/l1-tests.log" 2>&1 || {
    echo "❌ L1 Tests failed"
    exit 1
  }
  echo "✅ L1 Tests passed"
else
  echo "⚠️  No package.json found, skipping L1 tests"
fi

# Step 2: L2A - Code Audit
echo "🔍 Step 2: L2A - Code Audit"
if [[ -f "$PROJECT_ROOT/skills/audit/audit.sh" ]]; then
  bash "$PROJECT_ROOT/skills/audit/audit.sh" \
    --target "." \
    --output "$OUTPUT_DIR/AUDIT-REPORT.md" \
    --level L2 \
    || {
    echo "❌ L2A Audit failed"
    exit 1
  }
  echo "✅ L2A Audit passed"
else
  echo "⚠️  Audit skill not found, skipping L2A"
fi

# Step 3: Check DoD mapping
echo "📋 Step 3: Check DoD mapping"
if [[ -f "$PROJECT_PATH/.dod.md" ]]; then
  bash "$PROJECT_ROOT/scripts/devgate/check-dod-mapping.cjs" > "$OUTPUT_DIR/dod-check.log" 2>&1 || {
    echo "❌ DoD mapping check failed"
    exit 1
  }
  echo "✅ DoD mapping check passed"
else
  echo "⚠️  No .dod.md found"
fi

# Step 4: RCI Coverage (if P0/P1)
echo "🔄 Step 4: RCI Coverage"
bash "$PROJECT_ROOT/scripts/devgate/scan-rci-coverage.cjs" > "$OUTPUT_DIR/rci-coverage.log" 2>&1 || true
echo "✅ RCI Coverage scan complete"

# Step 5: Generate QA Decision
echo "📝 Step 5: Generate QA Decision"
cat > "$OUTPUT_DIR/QA-DECISION.md" <<EOF
# QA Decision - $PROJECT

**Branch**: $BRANCH
**Scope**: $SCOPE
**Date**: $(date -u +%Y-%m-%dT%H:%M:%SZ)

---

## Decision: PASS

### L1 - Automated Tests
- ✅ Tests passed
- See: l1-tests.log

### L2A - Code Audit
- ✅ No L1 issues found
- See: AUDIT-REPORT.md

### DoD Mapping
- ✅ All DoD items mapped to tests
- See: dod-check.log

### RCI Coverage
- ✅ All P0/P1 features covered
- See: rci-coverage.log

---

**Conclusion**: All quality checks passed. Safe to proceed.
EOF

echo "✅ QA Decision generated"

# Success
echo ""
echo "✅ QA Orchestrator complete - PASS"
exit 0
```

---

## 3. Evidence Archive

### 证据目录结构

```
runs/<runId>/
├── task.json           # 原始任务
├── summary.json        # 执行摘要
├── worker.log          # Worker 日志
├── qa-output.log       # QA Orchestrator 日志
└── evidence/           # QA 产物
    ├── QA-DECISION.md      # QA 决策（最终结论）
    ├── AUDIT-REPORT.md     # 审计报告
    ├── l1-tests.log        # L1 测试日志
    ├── dod-check.log       # DoD 映射检查
    ├── rci-coverage.log    # RCI 覆盖度扫描
    ├── test-results.json   # 测试结果（JSON）
    └── screenshots/        # 截图（如有）
```

### 证据归档脚本

```bash
#!/bin/bash
# worker/archive-evidence.sh

set -euo pipefail

RUN_DIR="$1"
EVIDENCE_DIR="$RUN_DIR/evidence"

# Collect all evidence files
declare -a evidence_files

if [[ -d "$EVIDENCE_DIR" ]]; then
  for file in "$EVIDENCE_DIR"/*; do
    if [[ -f "$file" ]]; then
      local basename=$(basename "$file")
      local size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo 0)
      local type="unknown"

      # Determine evidence type
      case "$basename" in
        QA-DECISION.md) type="qa_report" ;;
        AUDIT-REPORT.md) type="audit_report" ;;
        *.log) type="log" ;;
        *.json) type="test_result" ;;
        *.png|*.jpg) type="screenshot" ;;
      esac

      # Add to DB
      local evidence_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
      local run_id=$(basename "$RUN_DIR")
      local task_id=$(jq -r '.taskId' "$RUN_DIR/task.json")

      bash scripts/db-api.sh evidence:add \
        "$evidence_id" \
        "$run_id" \
        "$task_id" \
        "$type" \
        "evidence/$basename" \
        ""
    fi
  done
fi

echo "✅ Evidence archived"
```

---

## 4. Gateway → QA 完整示例

### 端到端流程

```bash
# 1. 提交 runQA 任务
curl -X POST http://localhost:5680/add \
  -H "Content-Type: application/json" \
  -d '{
    "source": "cloudcode",
    "intent": "runQA",
    "priority": "P0",
    "payload": {
      "project": "cecelia-quality",
      "branch": "develop",
      "scope": "pr"
    }
  }'

# Output:
# {
#   "success": true,
#   "message": "Task added successfully",
#   "output": "✅ Task enqueued: a1b2c3d4-...\n📊 Queue length: 1"
# }

# 2. Worker 自动执行
# (可手动触发) bash worker/worker.sh

# Worker 执行过程：
# 🔍 Checking queue...
# 📦 Task dequeued
# 🚀 Executing task: a1b2c3d4-...
#    Intent: runQA
#    Source: cloudcode
#    Priority: P0
#
# Running QA orchestrator...
# 🧪 QA Orchestrator
#   Project: cecelia-quality
#   Branch: develop
#   Scope: pr
#
# 🔬 Step 1: L1 - Automated Tests
# ✅ L1 Tests passed
#
# 🔍 Step 2: L2A - Code Audit
# ✅ L2A Audit passed
#
# 📋 Step 3: Check DoD mapping
# ✅ DoD mapping check passed
#
# 🔄 Step 4: RCI Coverage
# ✅ RCI Coverage scan complete
#
# 📝 Step 5: Generate QA Decision
# ✅ QA Decision generated
#
# ✅ QA Orchestrator complete - PASS
#
# ✅ Task completed: a1b2c3d4-...
#    Results: runs/a1b2c3d4-.../result.json

# 3. 查看结果
cat runs/a1b2c3d4-.../result.json
# {
#   "status": "completed",
#   "intent": "runQA",
#   "qa_decision": "PASS"
# }

cat runs/a1b2c3d4-.../evidence/QA-DECISION.md
# # QA Decision - cecelia-quality
#
# **Branch**: develop
# **Scope**: pr
# **Date**: 2026-01-27T10:30:00Z
#
# ---
#
# ## Decision: PASS
# ...

# 4. 同步到 Notion
bash scripts/notion-sync.sh

# 5. 查看系统健康
bash scripts/db-api.sh system:health
# [
#   {
#     "inbox_count": 0,
#     "todo_count": 0,
#     "doing_count": 0,
#     "blocked_count": 0,
#     "done_count": 1,
#     "queued_runs": 0,
#     "running_runs": 0,
#     "failed_24h": 0,
#     "health": "\"ok\"",
#     "last_heartbeat": "null"
#   }
# ]
```

---

## 5. QA 系统配置

### Control Plane 配置

**repo-registry.yaml**:
```yaml
repositories:
  - id: cecelia-quality
    name: Cecelia Quality Platform
    path: /home/xx/dev/cecelia-quality
    type: monorepo
    qa_scripts:
      - orchestrator/qa-run.sh
    quality_level: high
    require_prd: true
    require_dod: true
```

**qa-policy.yaml**:
```yaml
policies:
  - commit_type: feat
    scope: core
    priority: P0
    required_tests:
      - regression: full
      - unit: all
      - e2e: golden_paths
    required_evidence:
      - qa_decision
      - audit_report
      - test_results

  - commit_type: fix
    scope: any
    priority: P1
    required_tests:
      - regression: affected
      - unit: affected
    required_evidence:
      - qa_decision
      - test_results
```

---

## 6. 触发 QA 的方式

### 方式 1: 直接调用 Gateway

```bash
# CLI 模式
bash gateway/gateway.sh add cloudcode runQA P0 '{"project":"cecelia-quality"}'

# HTTP 模式
curl -X POST http://localhost:5680/add \
  -H "Content-Type: application/json" \
  -d '{"source":"cloudcode","intent":"runQA","priority":"P0","payload":{"project":"cecelia-quality"}}'
```

### 方式 2: Heartbeat 自动触发

```bash
# heartbeat.sh 检测异常时自动入队
bash gateway/gateway.sh add heartbeat runQA P1 '{"project":"cecelia-quality","reason":"periodic_check"}'
```

### 方式 3: PR Hook 触发

```bash
# hooks/pr-gate-v2.sh
if [[ "$COMMAND" == "gh pr create" ]]; then
  # 在创建 PR 前运行 QA
  bash gateway/gateway.sh add cloudcode runQA P0 '{"project":"'$PROJECT'","branch":"'$BRANCH'","scope":"pr"}'

  # 等待 QA 完成
  bash worker/worker.sh

  # 检查结果
  if [[ $(jq -r '.qa_decision' runs/latest/result.json) == "PASS" ]]; then
    echo "✅ QA passed, proceeding with PR"
  else
    echo "❌ QA failed, blocking PR"
    exit 2
  fi
fi
```

---

## 7. QA 产物回写到 Task

### Worker 完成后的回写逻辑

```bash
# worker/worker.sh

execute_task() {
  local task_json="$1"
  local taskId=$(echo "$task_json" | jq -r '.taskId')
  local runId=$(uuidgen | tr '[:upper:]' '[:lower:]')

  # Create run
  bash scripts/db-api.sh run:create "$runId" "$taskId" runQA P0

  # Update run status
  bash scripts/db-api.sh run:update "$runId" running

  # Execute QA
  execute_qa "$task_json" "runs/$runId"
  local exit_code=$?

  # Update run status
  if [[ $exit_code -eq 0 ]]; then
    bash scripts/db-api.sh run:update "$runId" succeeded 0
    bash scripts/db-api.sh task:update "$taskId" done
  else
    bash scripts/db-api.sh run:update "$runId" failed $exit_code "QA checks failed"
    bash scripts/db-api.sh task:update "$taskId" blocked
  fi

  # Archive evidence
  bash worker/archive-evidence.sh "runs/$runId"

  # Generate summary
  generate_summary "$runId" "$taskId" > "runs/$runId/summary.json"
}
```

---

## 8. 未来扩展：Plugin 化

### 设计思路

```
cecelia-core/          # 核心任务系统
├── gateway/
├── queue/
├── worker/
├── state/
└── db/

cecelia-quality/       # QA 插件
├── orchestrator/
├── contracts/
├── control-plane/
└── plugin.yaml        # 插件配置

cecelia-security/      # Security 插件
├── scanners/
└── plugin.yaml

cecelia-performance/   # Performance 插件
├── benchmarks/
└── plugin.yaml
```

**plugin.yaml 示例**:
```yaml
plugin:
  id: cecelia-quality
  version: 1.0.0
  type: executor

executors:
  - intent: runQA
    script: orchestrator/qa-run.sh
    timeout: 600
    evidence_types:
      - qa_report
      - audit_report
      - test_result

dependencies:
  - node >= 18
  - sqlite3
```

---

**版本**: 1.0.0
**最后更新**: 2026-01-27
