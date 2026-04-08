#!/usr/bin/env bash
# setup-staging-env.sh — 生成 .env.staging 配置文件
#
# 用途：
#   从 1Password (CS Vault) 拉取 staging 所需变量，写入 .env.staging。
#   staging-deploy.sh 在 .env.staging 不存在时会自动调用此脚本。
#
# 使用方式：
#   bash scripts/setup-staging-env.sh
#   bash scripts/setup-staging-env.sh --dry-run   # 只打印，不写文件
#
# 依赖：
#   - op CLI 已安装并已登录（1Password Service Account Token）
#   - 1Password CS Vault 中已有 "Cecelia Staging" 条目
#   - 或者可以基于 production .env 文件自动派生（DB_NAME 改为 cecelia_staging）
#
# 降级策略：
#   若 1Password 不可用，尝试从本地 .env 或 ~/.credentials/cecelia.env 派生

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_FILE="$ROOT_DIR/.env.staging"

DRY_RUN=false
for arg in "$@"; do
    case $arg in
        --dry-run) DRY_RUN=true ;;
    esac
done

log() { echo "[setup-staging-env] $*"; }
warn() { echo "[setup-staging-env] [WARN] $*"; }

log "开始生成 .env.staging..."

# ── 检查输出文件是否已存在 ─────────────────────────────────────────────────────
if [[ -f "$OUTPUT_FILE" ]] && [[ "$DRY_RUN" == false ]]; then
    log ".env.staging 已存在，跳过生成（如需重新生成请先删除该文件）"
    exit 0
fi

# ── 尝试方法 1：从 1Password CS Vault 拉取 ────────────────────────────────────
if command -v op > /dev/null 2>&1; then
    log "检测到 op CLI，尝试从 1Password 拉取 staging 配置..."
    # 尝试读取 "Cecelia Staging Env" 条目（需在 1Password 中预先创建）
    STAGING_ENV_CONTENT=$(op item get "Cecelia Staging Env" --vault "CS" --fields "notesPlain" 2>/dev/null || true)
    if [[ -n "$STAGING_ENV_CONTENT" ]]; then
        if [[ "$DRY_RUN" == true ]]; then
            log "[dry-run] 将写入 $OUTPUT_FILE"
            echo "$STAGING_ENV_CONTENT"
        else
            echo "$STAGING_ENV_CONTENT" > "$OUTPUT_FILE"
            chmod 600 "$OUTPUT_FILE"
            log "✓ .env.staging 已从 1Password 生成: $OUTPUT_FILE"
        fi
        exit 0
    else
        warn "1Password 中未找到 'Cecelia Staging Env' 条目，尝试降级方案..."
    fi
fi

# ── 尝试方法 2：从本地 production .env 或 ~/.credentials 派生 ─────────────────
SOURCE_ENV=""
if [[ -f "$ROOT_DIR/.env" ]]; then
    SOURCE_ENV="$ROOT_DIR/.env"
elif [[ -f "$HOME/.credentials/cecelia.env" ]]; then
    SOURCE_ENV="$HOME/.credentials/cecelia.env"
fi

if [[ -n "$SOURCE_ENV" ]]; then
    log "从 $SOURCE_ENV 派生 staging 配置..."
    # 读取 source 文件，将 DB_NAME 改为 cecelia_staging，PORT 改为 5222
    DERIVED_CONTENT=$(sed \
        -e 's/^DB_NAME=.*/DB_NAME=cecelia_staging/' \
        -e 's/^BRAIN_PORT=.*/BRAIN_PORT=5222/' \
        "$SOURCE_ENV")

    if [[ "$DRY_RUN" == true ]]; then
        log "[dry-run] 将写入 $OUTPUT_FILE（派生自 $SOURCE_ENV）"
        echo "$DERIVED_CONTENT"
    else
        echo "$DERIVED_CONTENT" > "$OUTPUT_FILE"
        chmod 600 "$OUTPUT_FILE"
        log "✓ .env.staging 已从 $SOURCE_ENV 派生生成: $OUTPUT_FILE"
        log "  注意：DB_NAME → cecelia_staging, BRAIN_PORT → 5222"
    fi
    exit 0
fi

# ── 方法 3：从 .env.docker.example 生成模板（最后降级）────────────────────────
EXAMPLE_FILE="$ROOT_DIR/.env.docker.example"
if [[ -f "$EXAMPLE_FILE" ]]; then
    warn "无法从 1Password 或 production env 派生，使用 .env.docker.example 生成模板"
    warn "生成的文件包含占位符，需要手动填写真实值！"
    TEMPLATE_CONTENT=$(sed \
        -e 's/^DB_NAME=.*/DB_NAME=cecelia_staging/' \
        -e 's/^BRAIN_PORT=.*/BRAIN_PORT=5222/' \
        -e 's/YOUR_PASSWORD_HERE/FILL_ME_IN/' \
        "$EXAMPLE_FILE")
    if [[ "$DRY_RUN" == true ]]; then
        log "[dry-run] 将写入模板到 $OUTPUT_FILE"
        echo "$TEMPLATE_CONTENT"
    else
        echo "$TEMPLATE_CONTENT" > "$OUTPUT_FILE"
        chmod 600 "$OUTPUT_FILE"
        warn "⚠ .env.staging 已生成（模板），请编辑并填入真实 DB_PASSWORD 等配置"
        warn "  文件路径：$OUTPUT_FILE"
    fi
    exit 0
fi

# ── 所有方法均失败 ────────────────────────────────────────────────────────────
warn "无法生成 .env.staging：1Password 不可用，无本地 .env，无 .env.docker.example"
warn "手动创建方式：cp .env.docker.example .env.staging && vim .env.staging"
exit 1
