#!/usr/bin/env bash
# =============================================================================
# write-current-state.sh — 写入系统健康状态到 .agent-knowledge/CURRENT_STATE.md
#
# 功能：
# - 读取最新 capability-probe 结果（来自 DB 的 cecelia_events 表）
# - 读取 Brain 健康状态（alertness、active tasks）
# - 写到主仓库 .agent-knowledge/CURRENT_STATE.md
#
# 调用时机：/dev Stage 4 Ship 阶段（PR 合并后）
# 调用方式：bash scripts/write-current-state.sh
# =============================================================================

set -euo pipefail

BRAIN_URL="${BRAIN_API_URL:-http://localhost:5221}"
TIMESTAMP=$(TZ=Asia/Shanghai date "+%Y-%m-%d %H:%M:%S %Z" 2>/dev/null || date "+%Y-%m-%d %H:%M:%S")

# ─── 找到主仓库路径 ───────────────────────────────────────────────────────────
# 从 worktree 或主仓库均可正确解析
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null || echo ".git")
if [[ "$GIT_COMMON" == ".git" ]]; then
    MAIN_REPO=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
else
    MAIN_REPO=$(dirname "$GIT_COMMON")
fi

OUTPUT_FILE="${MAIN_REPO}/.agent-knowledge/CURRENT_STATE.md"
mkdir -p "$(dirname "$OUTPUT_FILE")"

echo "[write-current-state] 主仓库: $MAIN_REPO"
echo "[write-current-state] 输出文件: $OUTPUT_FILE"

# ─── 读取 Brain 警觉等级 ──────────────────────────────────────────────────────
ALERTNESS_JSON=$(curl -s --max-time 5 "${BRAIN_URL}/api/brain/alertness" 2>/dev/null || echo "{}")
ALERTNESS_LEVEL=$(echo "$ALERTNESS_JSON" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('levelName', 'UNKNOWN'))
except:
    print('UNKNOWN')
" 2>/dev/null || echo "UNKNOWN")
ALERTNESS_NUM=$(echo "$ALERTNESS_JSON" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('level', '?'))
except:
    print('?')
" 2>/dev/null || echo "?")

# ─── 读取最新 Capability Probe 结果（DB） ────────────────────────────────────
PROBE_DATA=$(PGPASSWORD="${PGPASSWORD:-cecelia}" psql -h localhost -U "${PGUSER:-cecelia}" -d cecelia -t -c "
SELECT payload::text
FROM cecelia_events
WHERE event_type = 'capability_probe'
ORDER BY created_at DESC
LIMIT 1;
" 2>/dev/null | tr -d ' \n' | head -c 10000 || echo "")

PROBE_SECTION=""
if [[ -n "$PROBE_DATA" && "$PROBE_DATA" != "" ]]; then
    PROBE_SECTION=$(echo "$PROBE_DATA" | python3 -c "
import sys, json
try:
    raw = sys.stdin.read().strip()
    d = json.loads(raw)
    ts = d.get('timestamp', '?')[:19].replace('T', ' ')
    total = d.get('total', 0)
    passed = d.get('passed', 0)
    failed = d.get('failed', 0)
    probes = d.get('probes', [])

    lines = []
    lines.append(f'> 最后探针时间：{ts} UTC | 总计：{total} | ✅ 通过：{passed} | ❌ 失败：{failed}')
    lines.append('')
    lines.append('| 探针名 | 描述 | 状态 | 耗时 |')
    lines.append('|--------|------|------|------|')
    for p in probes:
        status = '✅' if p.get('ok') else '❌'
        name = p.get('name', '?')
        desc = p.get('description', '')
        latency = p.get('latency_ms', '?')
        detail = p.get('detail', '') or p.get('error', '') or ''
        detail_short = (detail[:50] + '...') if len(detail) > 50 else detail
        row_extra = f' ({detail_short})' if detail_short and not p.get('ok') else ''
        lines.append(f'| \`{name}\` | {desc}{row_extra} | {status} | {latency}ms |')
    print('\n'.join(lines))
except Exception as e:
    print(f'（解析失败：{e}）')
" 2>/dev/null || echo "（DB 查询失败，无探针数据）")
else
    PROBE_SECTION="（尚无探针数据，Brain 启动 30s 后首次探针）"
fi

# ─── 读取进行中任务 ────────────────────────────────────────────────────────────
TASKS_JSON=$(curl -s --max-time 5 "${BRAIN_URL}/api/brain/tasks?status=in_progress&limit=8" 2>/dev/null || echo "[]")
TASKS_SECTION=$(echo "$TASKS_JSON" | python3 -c "
import sys, json
try:
    tasks = json.load(sys.stdin)
    if not tasks:
        print('（无进行中任务）')
    else:
        lines = []
        for t in tasks[:8]:
            title = t.get('title', '?')[:60]
            prio = t.get('priority', '')
            ttype = t.get('task_type', '')
            lines.append(f'- [{prio}] {title} ({ttype})')
        print('\n'.join(lines))
except:
    print('（查询失败）')
" 2>/dev/null || echo "（查询失败）")

# ─── 读取 Brain 健康状态 ────────────────────────────────────────────────────
HEALTH_JSON=$(curl -s --max-time 5 "${BRAIN_URL}/api/brain/health" 2>/dev/null || echo "{}")
HEALTH_STATUS=$(echo "$HEALTH_JSON" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('status', 'unknown'))
except:
    print('unknown')
" 2>/dev/null || echo "unknown")

# ─── 写入 CURRENT_STATE.md ────────────────────────────────────────────────────
cat > "$OUTPUT_FILE" <<STATEOF
---
generated: ${TIMESTAMP}
source: write-current-state.sh
---

# Cecelia 系统当前状态

> 由 \`/dev\` Stage 4 自动生成，每次 PR 合并后更新。
> 生成时间：${TIMESTAMP}

---

## 系统健康

| 指标 | 状态 |
|------|------|
| Brain API | ${HEALTH_STATUS} |
| 警觉等级 | ${ALERTNESS_NUM} - ${ALERTNESS_LEVEL} |

---

## Capability Probe（能力链路探针）

${PROBE_SECTION}

---

## 进行中任务

${TASKS_SECTION}

---

> 要查最新状态：\`curl localhost:5221/api/brain/health\`
> 要触发探针：Brain 每小时自动运行，或重启 Brain 触发。
STATEOF

echo "[write-current-state] ✅ CURRENT_STATE.md 已写入: $OUTPUT_FILE"
