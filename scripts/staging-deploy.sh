#!/usr/bin/env bash
# staging-deploy.sh — 部署 Brain 到 Staging 环境（端口 5222）
#
# 用途：
#   Safe Lane 部署流程的第一步，先在 staging 验证，通过后再提升到 production。
#
# 使用方式：
#   bash scripts/staging-deploy.sh
#   bash scripts/staging-deploy.sh --dry-run
#
# 依赖：
#   - cecelia-brain:${VERSION} 镜像已由 brain-deploy.sh 构建（复用同版本镜像）
#   - .env.staging 文件存在（包含 DB_PASSWORD 等敏感配置）
#   - cecelia_staging 数据库已存在（或 postgres 用户有权创建）
#
# 优雅降级：
#   - 若 docker 不可用 → 打印警告并以 exit 0 退出（staging skipped, no docker）
#   - 若 .env.staging 不存在且无法自动生成 → 打印警告并以 exit 0 退出（staging skipped, no env）
#   - 这两种情况都会输出 STAGING_SKIP_REASON=no_docker/no_env，供调用方识别
#   - staging 是"加分项"，不应无限期阻断 production 发布

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BRAIN_DIR="$ROOT_DIR/packages/brain"
STAGING_PORT=5222
STAGING_CONTAINER="cecelia-node-brain-staging"
STAGING_DB="cecelia_staging"

VERSION=$(node -e "console.log(require('$BRAIN_DIR/package.json').version)")
ENV_REGION="${ENV_REGION:-us}"

DRY_RUN=false
for arg in "$@"; do
    case $arg in
        --dry-run) DRY_RUN=true ;;
    esac
done

if [[ "$DRY_RUN" != true && -z "${CECELIA_STAGING_EXACT_ROOT:-}" ]]; then
    bash "$SCRIPT_DIR/lib/release-run-guard.sh" staging
    EXACT_SHA="${KERNEL_RELEASE_MERGE_SHA:?KERNEL_RELEASE_MERGE_SHA required}"
    EXACT_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/cecelia-staging-release.XXXXXX")
    cleanup_exact_root() {
        git -C "$ROOT_DIR" worktree remove --force "$EXACT_ROOT" >/dev/null 2>&1 || true
    }
    trap cleanup_exact_root EXIT
    git -C "$ROOT_DIR" fetch --no-tags origin "$EXACT_SHA" \
        || git -C "$ROOT_DIR" fetch --no-tags origin main
    git -C "$ROOT_DIR" worktree add --detach "$EXACT_ROOT" "$EXACT_SHA"
    [[ "$(git -C "$EXACT_ROOT" rev-parse HEAD)" == "$EXACT_SHA" ]] \
        || { echo "staging exact-SHA worktree mismatch" >&2; exit 78; }
    if [[ -f "$ROOT_DIR/.env.staging" ]]; then
        cp "$ROOT_DIR/.env.staging" "$EXACT_ROOT/.env.staging"
        chmod 600 "$EXACT_ROOT/.env.staging"
    fi
    CECELIA_STAGING_EXACT_ROOT="$EXACT_ROOT" bash "$EXACT_ROOT/scripts/staging-deploy.sh" "$@"
    exit $?
fi

echo "=== Staging Deploy: cecelia-brain v${VERSION} (port=${STAGING_PORT}, db=${STAGING_DB}) ==="
echo ""

# ── 检查 docker 是否可用 ──────────────────────────────────────────────────────
if ! command -v docker > /dev/null 2>&1; then
    echo "[WARN] docker 命令不在 PATH 中，staging 部署跳过"
    echo "  原因：此机器未安装 docker 或 docker 不在 PATH"
    echo "  影响：staging 验证被跳过（STAGING_SKIP_REASON=no_docker）"
    echo "  说明：ReleaseRun 保持阻断，禁止进入 production"
    echo ""
    echo "=== Staging Deploy SKIPPED (no docker) ==="
    # 输出机器可读的跳过原因，供 ops.js 解析
    echo "STAGING_SKIP_REASON=no_docker"
    exit 0
fi

# ── 检查 .env.staging ──────────────────────────────────────────────────────────
if [[ ! -f "$ROOT_DIR/.env.staging" ]]; then
    echo "[WARN] .env.staging 不存在，尝试自动生成..."
    # 尝试运行 setup 脚本（若存在）
    SETUP_SCRIPT="$SCRIPT_DIR/setup-staging-env.sh"
    if [[ -f "$SETUP_SCRIPT" ]]; then
        echo "  执行: bash $SETUP_SCRIPT"
        if bash "$SETUP_SCRIPT" > /dev/null 2>&1; then
            echo "  ✓ .env.staging 已自动生成"
        else
            echo "  setup-staging-env.sh 执行失败，staging 部署跳过"
        fi
    fi

    # 再次检查（setup 可能成功创建了）
    if [[ ! -f "$ROOT_DIR/.env.staging" ]]; then
        echo "[WARN] .env.staging 仍不存在，staging 部署跳过"
        echo "  原因：staging 环境未配置（STAGING_SKIP_REASON=no_env）"
        echo "  修复：运行 bash scripts/setup-staging-env.sh 生成 .env.staging"
        echo "  参考：.env.docker.example 中的变量定义"
        echo ""
        echo "=== Staging Deploy SKIPPED (no .env.staging) ==="
        # 输出机器可读的跳过原因，供 ops.js 解析
        echo "STAGING_SKIP_REASON=no_env"
        exit 0
    fi
fi

# ── 检查镜像是否存在（复用 production 同版本镜像，不重新 build）──────────────
echo "[1/5] 检查 cecelia-brain:${VERSION} 镜像..."
if [[ "$DRY_RUN" == true ]]; then
    echo "  [dry-run] docker image inspect cecelia-brain:${VERSION}"
elif ! docker image inspect "cecelia-brain:${VERSION}" > /dev/null 2>&1; then
    echo "[FAIL] 镜像 cecelia-brain:${VERSION} 不存在，请先运行 bash scripts/brain-build.sh"
    exit 1
fi
echo "  ✓ 镜像存在: cecelia-brain:${VERSION}"
echo ""

# ── 确保 staging DB 存在 ──────────────────────────────────────────────────────
echo "[2/5] 确保 staging DB（${STAGING_DB}）存在..."
if [[ "$DRY_RUN" == true ]]; then
    echo "  [dry-run] docker run --rm cecelia-brain:${VERSION} 创建 ${STAGING_DB}"
else
    # 读取 DB 连接信息（优先从 .env.staging 读取）
    DB_HOST_VAL=$(grep "^DB_HOST=" "$ROOT_DIR/.env.staging" 2>/dev/null | cut -d= -f2 || echo "localhost")
    DB_PORT_VAL=$(grep "^DB_PORT=" "$ROOT_DIR/.env.staging" 2>/dev/null | cut -d= -f2 || echo "5432")
    DB_USER_VAL=$(grep "^DB_USER=" "$ROOT_DIR/.env.staging" 2>/dev/null | cut -d= -f2 || echo "cecelia")
    DB_PASS_VAL=$(grep "^DB_PASSWORD=" "$ROOT_DIR/.env.staging" 2>/dev/null | cut -d= -f2 || echo "")

    # 尝试创建 staging DB（已存在则忽略错误）
    PGPASSWORD="$DB_PASS_VAL" psql -h "$DB_HOST_VAL" -p "$DB_PORT_VAL" -U "$DB_USER_VAL" -d postgres \
        -c "CREATE DATABASE ${STAGING_DB} OWNER ${DB_USER_VAL};" 2>/dev/null \
        && echo "  ✓ 数据库 ${STAGING_DB} 已创建" \
        || echo "  ✓ 数据库 ${STAGING_DB} 已存在，跳过创建"
fi
echo ""

# ── 运行 migrations（针对 staging DB）────────────────────────────────────────
echo "[3/5] 运行 migrations（${STAGING_DB}）..."
if [[ "$DRY_RUN" == true ]]; then
    echo "  [dry-run] docker run --rm --network host -e DB_NAME=${STAGING_DB} cecelia-brain:${VERSION} node src/migrate.js"
else
    docker run --rm --network host \
      --env-file "$ROOT_DIR/.env.staging" \
      -e "DB_NAME=${STAGING_DB}" \
      -e "ENV_REGION=${ENV_REGION}" \
      "cecelia-brain:${VERSION}" \
      node src/migrate.js
fi
echo ""

# ── 停止旧 staging 容器（如有）──────────────────────────────────────────────
echo "[4/5] 重启 staging 容器..."
if [[ "$DRY_RUN" == true ]]; then
    echo "  [dry-run] docker compose -f docker-compose.staging.yml up -d"
else
    # 停止旧容器（忽略不存在的错误）
    docker stop "$STAGING_CONTAINER" 2>/dev/null || true
    docker rm "$STAGING_CONTAINER" 2>/dev/null || true

    # 启动新容器
    if ! BRAIN_VERSION="${VERSION}" ENV_REGION="${ENV_REGION}" \
        docker compose -f "$ROOT_DIR/docker-compose.staging.yml" up -d; then
        echo ""
        echo "[FAIL] staging 容器启动失败"
        exit 1
    fi
fi
echo ""

# ── 健康检查 ──────────────────────────────────────────────────────────────────
if [[ "$DRY_RUN" == true ]]; then
    echo "[5/6] [dry-run] 等待 staging 健康检查 localhost:${STAGING_PORT}..."
    echo "[6/6] [dry-run] bash $SCRIPT_DIR/staging-verify.sh"
    echo ""
    echo "=== [dry-run] Staging Deploy SUCCESS ==="
    exit 0
fi

echo "[5/6] 等待 staging 健康检查（docker health 最多 180s）..."
TRIES=0
MAX_TRIES=36
HEALTHY=false
while [ $TRIES -lt $MAX_TRIES ]; do
    sleep 5
    TRIES=$((TRIES + 1))
    # staging-e2e-runner 在生产 brain 容器内跑此脚本，容器内 localhost != staging 容器，
    # 不能 curl localhost:5222。改查 staging 容器自己的 healthcheck（docker socket 已挂）。
    HSTATUS=$(docker inspect "${STAGING_CONTAINER}" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo "missing")
    if [ "$HSTATUS" = "healthy" ]; then
        echo "  staging container ${STAGING_CONTAINER} health=healthy"
        HEALTHY=true
        break
    fi
    if [ "$HSTATUS" = "unhealthy" ]; then
        echo "  staging container health=unhealthy, fail early"
        break
    fi
    echo "  Attempt ${TRIES}/${MAX_TRIES} health=${HSTATUS}"
done

if [[ "$HEALTHY" != true ]]; then
    echo ""
    echo "[FAIL] staging 健康检查超时（${MAX_TRIES}次 × 5s）"
    echo "  日志: docker logs ${STAGING_CONTAINER} --tail 50"
    echo "  清理: docker stop ${STAGING_CONTAINER} && docker rm ${STAGING_CONTAINER}"
    exit 1
fi
echo ""

# ── staging 验证（护栏核心）──────────────────────────────────────────────────
# health check 只证明端口响应；staging-verify.sh 做真正的验证（tick 隔离 / DB /
# 端点契约）。verification 失败必须以非 0 退出，让 ops.js 标记 status=failed，
# CI deploy.yml 据此阻断 production deploy → 生产实例不被触碰，客户无感。
echo "[6/6] 运行 staging 验证（staging-verify.sh）..."
VERIFY_SCRIPT="$SCRIPT_DIR/staging-verify.sh"
if [[ ! -f "$VERIFY_SCRIPT" ]]; then
    echo "[FAIL] 缺少 ${VERIFY_SCRIPT}，无法验证 staging — 阻断 production"
    exit 1
fi
if bash "$VERIFY_SCRIPT"; then
    echo ""
    echo "=== Staging Deploy SUCCESS: cecelia-brain v${VERSION} 在端口 ${STAGING_PORT} 验证通过 ==="
    exit 0
else
    echo ""
    echo "[FAIL] staging 验证失败 — 阻断 production deploy（生产端口未触碰）"
    echo "  日志: docker logs ${STAGING_CONTAINER} --tail 50"
    echo "  清理: docker stop ${STAGING_CONTAINER} && docker rm ${STAGING_CONTAINER}"
    exit 1
fi
