#!/usr/bin/env bash
# write-current-state.sh
# 查询 Brain API，生成 .agent-knowledge/CURRENT_STATE.md
# 由 /dev Stage 4 自动调用，也可手动运行
# Brain 离线时静默跳过（exit 0）

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
OUTPUT_FILE="${REPO_ROOT}/.agent-knowledge/CURRENT_STATE.md"

# 生成上海时间戳
TIMESTAMP=$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date '+%Y-%m-%d %H:%M:%S')
TZ_LABEL="CST"

# ── 检查 Brain 是否在线 ──────────────────────────────────────────
HEALTH_RAW=$(curl -sf --connect-timeout 3 "${BRAIN_URL}/api/brain/health" 2>/dev/null || echo "")
if [[ -z "$HEALTH_RAW" ]]; then
  echo "[write-current-state] Brain 离线，跳过状态更新" >&2
  exit 0
fi

# ── 查询各 API ──────────────────────────────────────────────────
ALERTNESS_RAW=$(curl -sf --connect-timeout 3 "${BRAIN_URL}/api/brain/alertness" 2>/dev/null || echo "{}")
TASKS_RAW=$(curl -sf --connect-timeout 3 "${BRAIN_URL}/api/brain/tasks?status=in_progress&limit=10" 2>/dev/null || echo "[]")
PROBES_RAW=$(curl -sf --connect-timeout 3 "${BRAIN_URL}/api/brain/probes/status" 2>/dev/null || echo "{}")  # capability probe

# ── 解析数据并写出 markdown（用 python3）──────────────────────────────────────
python3 - \
  "$OUTPUT_FILE" "$TIMESTAMP" "$TZ_LABEL" \
  "$HEALTH_RAW" "$ALERTNESS_RAW" "$TASKS_RAW" "$PROBES_RAW" \
<<'PYEOF'
import json, sys, os

output_file   = sys.argv[1]
timestamp     = sys.argv[2]
tz_label      = sys.argv[3]
health_raw    = sys.argv[4]
alertness_raw = sys.argv[5]
tasks_raw     = sys.argv[6]
probes_raw    = sys.argv[7]

def safe_parse(s, fallback):
    try:
        return json.loads(s)
    except Exception:
        return fallback

health    = safe_parse(health_raw, {})
alertness = safe_parse(alertness_raw, {})
tasks     = safe_parse(tasks_raw, [])
probes    = safe_parse(probes_raw, {})

# ── 系统健康 ────────────────────────────────────────────────
brain_status = health.get('status', 'unknown')
alert_level  = alertness.get('level', '?')
alert_name   = alertness.get('levelName', 'UNKNOWN')

# ── 进行中任务 ──────────────────────────────────────────────
if isinstance(tasks, list) and len(tasks) > 0:
    task_rows = []
    for t in tasks[:10]:
        title    = t.get('title', '未知')
        priority = t.get('priority', '-')
        task_rows.append(f"| {priority} | {title} |")
    tasks_section = "| 优先级 | 任务标题 |\n|--------|----------|\n" + "\n".join(task_rows)
else:
    tasks_section = "（无进行中任务）"

# ── Capability Probe ──────────────────────────────────────
probe_table = "（探针数据不可用）"
if probes.get('success') and probes.get('recent_results'):
    result  = probes['recent_results'][0]
    payload = result.get('payload', {})
    probe_ts = result.get('created_at', '')[:19].replace('T', ' ')
    total   = payload.get('total', 0)
    passed  = payload.get('passed', 0)
    failed  = payload.get('failed', 0)

    probe_descs = {
        'db':               '数据库连接+核心表可读',
        'dispatch':         '任务派发链路（tasks表可写+executor模块可import）',
        'auto_fix':         'auto-fix链路dry-run（shouldAutoFix函数可调用）',
        'notify':           '飞书通知链路（alerting模块可import+函数可调用）',
        'cortex':           'CortexRCA链路（cortex模块可import）',
        'monitor_loop':     'MonitorLoop运行状态',
        'rumination':       '反刍系统（24h内是否有产出）',
        'evolution':        '进化追踪（是否有evolution记录）',
        'consolidation':    '记忆合并（48h内是否有合并记录）',
        'self_drive_health':'Self-Drive自驱引擎（24h内是否成功创建任务）',
    }

    rows = []
    for p in payload.get('probes', []):
        name    = p.get('name', '')
        ok      = p.get('ok', False)
        latency = p.get('latency_ms', 0)
        desc    = probe_descs.get(name, name)
        icon    = '✅' if ok else '❌'
        rows.append(f"| `{name}` | {desc} | {icon} | {latency}ms |")

    probe_meta  = f"> 最后探针时间：{probe_ts} UTC | 总计：{total} | ✅ 通过：{passed} | ❌ 失败：{failed}"
    probe_table = probe_meta + "\n\n| 探针名 | 描述 | 状态 | 耗时 |\n|--------|------|------|------|\n" + "\n".join(rows)

# ── 生成文件内容 ─────────────────────────────────────────────
content = f"""---
generated: {timestamp} {tz_label}
source: write-current-state.sh
---

# Cecelia 系统当前状态

> 由 `/dev` Stage 4 自动生成，每次 PR 合并后更新。
> 生成时间：{timestamp} {tz_label}

---

## 系统健康

| 指标 | 状态 |
|------|------|
| Brain API | {brain_status} |
| 警觉等级 | {alert_level} - {alert_name} |

---

## Capability Probe（能力链路探针）

{probe_table}

---

## 进行中任务

{tasks_section}

---

> 要查最新状态：`curl localhost:5221/api/brain/health`
> 要触发探针：Brain 每小时自动运行，或重启 Brain 触发。
"""

os.makedirs(os.path.dirname(output_file), exist_ok=True)
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(content)

print(f"[write-current-state] ✅ 状态快照已更新: {output_file}")
print(f"[write-current-state]    Brain: {brain_status} | 警觉等级: {alert_level}-{alert_name}")
PYEOF
