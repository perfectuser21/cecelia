#!/usr/bin/env bash
# ============================================================================
# execution-logger.sh — /dev 工作流执行日志记录器
# ============================================================================
# 在每一步的 pass/fail/blocked/done 时写一行 JSON 到 .dev-execution-log.jsonl，
# 让任务完成后能回溯整个执行过程中发生了什么。
#
# 用法：
#   source packages/engine/lib/execution-logger.sh
#   _devlog_event "verify-step" "step1" "fail" "Task Card 中没有 Test: 字段"
#   _devlog_event "verify-step" "step2" "pass" "Gate 1 + Gate 2 通过"
#   _devlog_event "devloop-check" "ci" "blocked" "CI 进行中（in_progress）"
#
# 日志格式（每行一个 JSON）：
#   {"ts":"2026-03-19T21:00:00+08:00","source":"verify-step","step":"step1","event":"fail","detail":"...","branch":"cp-xxx"}
#
# 版本: v1.1.0
# 创建: 2026-03-19
# ============================================================================

# 日志文件路径（延迟初始化）
_DEVLOG_FILE=""

# 初始化日志文件路径
_devlog_init() {
    if [[ -n "$_DEVLOG_FILE" ]]; then
        return 0
    fi

    local project_root
    project_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
    local branch
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

    _DEVLOG_FILE="${project_root}/.dev-execution-log.${branch}.jsonl"
}

# ============================================================================
# 核心函数: _devlog_event
# ============================================================================
# 参数:
#   $1: source  — 调用来源（verify-step / devloop-check / cleanup）
#   $2: step    — 步骤标识（step1 / step2 / step4 / ci / pr / merge 等）
#   $3: event   — 事件类型（pass / fail / blocked / done / start）
#   $4: detail  — 详情描述（可选，失败原因等）
# ============================================================================
_devlog_event() {
    local source="${1:-unknown}"
    local step="${2:-unknown}"
    local event="${3:-unknown}"
    local detail="${4:-}"

    _devlog_init

    local ts branch
    ts=$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

    # 用 jq 安全构建 JSON（处理特殊字符）
    if command -v jq &>/dev/null; then
        jq -nc \
            --arg ts "$ts" \
            --arg source "$source" \
            --arg step "$step" \
            --arg event "$event" \
            --arg detail "$detail" \
            --arg branch "$branch" \
            '{ts:$ts,source:$source,step:$step,event:$event,detail:$detail,branch:$branch}' \
            >> "$_DEVLOG_FILE" 2>/dev/null
    else
        # jq 不可用时的简单 fallback（转义双引号）
        local safe_detail
        safe_detail=$(printf '%s' "$detail" | sed 's/"/\\"/g' | tr '\n' ' ' | head -c 500)
        printf '{"ts":"%s","source":"%s","step":"%s","event":"%s","detail":"%s","branch":"%s"}\n' \
            "$ts" "$source" "$step" "$event" "$safe_detail" "$branch" \
            >> "$_DEVLOG_FILE" 2>/dev/null
    fi

    return 0
}

# ============================================================================
# 辅助函数: _devlog_summary
# ============================================================================
# 从日志文件生成质检摘要 JSON。供 generate-report.sh 调用。
#
# 参数:
#   $1: log_file — 日志文件路径（可选，默认自动检测）
#
# 输出到 stdout：
# {
#   "total_events": 12,
#   "verify_fails": {"step1": ["原因1"], "step2": []},
#   "ci_fail_count": 1,
#   "ci_failures": ["CI 失败（failure）"],
#   "blocked_count": 5,
#   "score": 7
# }
# ============================================================================
_devlog_summary() {
    local log_file="${1:-}"

    if [[ -z "$log_file" ]]; then
        _devlog_init
        log_file="$_DEVLOG_FILE"
    fi

    if [[ ! -f "$log_file" ]] || ! command -v jq &>/dev/null; then
        echo '{"total_events":0,"verify_fails":{},"ci_fail_count":0,"ci_failures":[],"blocked_count":0,"score":10}'
        return 0
    fi

    jq -s '
    . as $all |
    ($all | length) as $total |

    # verify-step fail 按步骤分组
    [.[] | select(.source == "verify-step" and .event == "fail")] |
    group_by(.step) | map({key: .[0].step, value: [.[].detail]}) |
    from_entries as $verify_fails |

    # verify-step fail 总数
    ([$verify_fails | to_entries[] | .value | length] | add // 0) as $vf_total |

    # CI 失败
    [$all[] | select(.step == "ci" and .event == "blocked" and ((.detail // "") | test("失败|failure"; "i")))] as $ci_fails |

    # blocked 总次数
    ([$all[] | select(.event == "blocked")] | length) as $blocked |

    # 评分（10分制）：verify fail -1.5，CI fail -2，blocked>5 额外 -0.5/次
    ((10 - ($vf_total * 1.5) - (($ci_fails | length) * 2) - (if $blocked > 5 then (($blocked - 5) * 0.5) else 0 end)) |
    (if . < 0 then 0 elif . > 10 then 10 else . end) | (. * 10 | floor) / 10) as $score |

    {
        total_events: $total,
        verify_fails: $verify_fails,
        ci_fail_count: ($ci_fails | length),
        ci_failures: [$ci_fails[] | .detail],
        blocked_count: $blocked,
        score: $score
    }
    ' "$log_file" 2>/dev/null || echo '{"total_events":0,"verify_fails":{},"ci_fail_count":0,"ci_failures":[],"blocked_count":0,"score":10}'
}
