#!/usr/bin/env bash
# 仅调用方持有共同发布锁时执行。候选仅拿隔离数据库，不继承生产凭据或挂载。
brain_release_lock() {
    mkdir -p "$ROOT_DIR/logs"
    exec 9>"$ROOT_DIR/logs/brain-release.lock"
    flock -x 9
}

stage_remove_container() {
    local name="$1"
    case "$name" in cecelia-admission-db|cecelia-admission-brain) ;; *) return 1;; esac
    if docker inspect "$name" >/dev/null 2>&1; then
        [[ "$(docker inspect "$name" --format '{{index .Config.Labels "cecelia.staging"}}')" == admission-v1 ]] || return 1
        if [[ -n "${1:-}" && -n "${2:-}" ]]; then
            [[ "$(docker inspect "$name" --format '{{index .Config.Labels "cecelia.staging.request"}}')" == "$2" ]] || return 1
        fi
        docker stop "$name" >/dev/null
        docker rm -v "$name" >/dev/null
    fi
}

stage_remove_network() {
    if docker network inspect cecelia-admission >/dev/null 2>&1; then
        [[ "$(docker network inspect cecelia-admission --format '{{index .Labels "cecelia.staging"}}')" == admission-v1 ]] || return 1
        if [[ -n "${1:-}" ]]; then
            [[ "$(docker network inspect cecelia-admission --format '{{index .Labels "cecelia.staging.request"}}')" == "$1" ]] || return 1
        fi
        docker network rm cecelia-admission >/dev/null
    fi
}

stage_receipt() {
    local status="$1"
    STAGE_STATUS="$status" SHA="$sha" IMAGE="$image" VERSION="$version" STAGE_REQUEST="$request_id" node -e '
      const fs=require("fs"),p=process.argv[1],e=process.env;
      fs.writeFileSync(p+".new",JSON.stringify({status:e.STAGE_STATUS,request_id:e.STAGE_REQUEST,sha:e.SHA,image_id:e.IMAGE,version:e.VERSION,isolated:e.STAGE_STATUS==="success",verified_at:new Date().toISOString()}));fs.renameSync(p+".new",p);
    ' "$ROOT_DIR/logs/brain-staging-receipt.json"
}

stage_candidate() (
    local sha="$1" image="$2" version="$3"
    [[ "$sha" =~ ^[a-f0-9]{40}$ && "$image" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
    local network=cecelia-admission db=cecelia-admission-db app=cecelia-admission-brain
    local postgres_image=pgvector/pgvector:pg17
    local request_id="${STAGING_REQUEST_ID:-$(node -e 'process.stdout.write(require("crypto").randomUUID())')}"
    [[ "$request_id" =~ ^[a-f0-9-]{36}$ ]] || return 1
    stage_receipt running
    trap 'status=$?; if [[ "$status" != 0 ]]; then stage_remove_container "$app" "$request_id" || true; stage_remove_container "$db" "$request_id" || true; stage_remove_network "$request_id" || true; stage_receipt failed || true; fi; exit "$status"' EXIT
    local actual_sha
    actual_sha=$(docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$image" | sed -n 's/^GIT_SHA=//p')
    [[ "$actual_sha" == "$sha" ]] || { echo '候选镜像 SHA 不符' >&2; return 1; }
    # 同一锁覆盖候选准备和生产切换；独立 staging 入口也持有这把锁。
    stage_remove_container "$app"
    stage_remove_container "$db"
    stage_remove_network
    # 根盘仅保留少量日志；克隆流不落根盘。Docker数据盘保留5GiB及两倍实际薄快照预算。
    local root_free
    root_free=$(df -Pk "$ROOT_DIR" | awk 'NR==2 {print $4}')
    [[ "$root_free" =~ ^[0-9]+$ && "$root_free" -ge 524288 ]] || { echo '根盘空间不足，禁止候选克隆' >&2; return 1; }
    docker network create --internal --label cecelia.staging=admission-v1 --label "cecelia.staging.request=$request_id" "$network" >/dev/null
    # 内部网络不发布数据库端口，trust 仅在本次独立容器内；不创建/改动生产角色。
    docker run -d --name "$db" --label cecelia.staging=admission-v1 --label "cecelia.staging.request=$request_id" --log-opt max-size=10m --log-opt max-file=2 --network "$network" --network-alias stage-db \
        -e POSTGRES_USER=cecelia -e POSTGRES_DB=cecelia_staging -e POSTGRES_HOST_AUTH_METHOD=trust \
        "$postgres_image" >/dev/null
    local ready=false n
    for n in $(seq 1 60); do
        if docker exec "$db" pg_isready -U cecelia -d cecelia_staging >/dev/null 2>&1; then ready=true; break; fi
        sleep 2
    done
    [[ "$ready" == true ]] || { echo '隔离数据库未就绪' >&2; return 1; }
    local estimated available
    estimated=$(docker exec cecelia-node-brain node --input-type=module -e '
      const {default:pg}=await import("pg");const {DB_DEFAULTS}=await import("./src/db-config.js");
      const c=new pg.Client(DB_DEFAULTS);await c.connect();
      try { const r=await c.query("SELECT COALESCE(sum(pg_total_relation_size(c.oid)),0)::text AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind=ANY($2) AND NOT(c.relname=ANY($3))",["public",["r","m"],["memory_stream","cecelia_events","alertness_metrics","checkpoint_writes","checkpoint_blobs","checkpoints","captures"]]);process.stdout.write(r.rows[0].bytes); }finally{await c.end();}
    ')
    available=$(docker exec "$db" df -Pk /var/lib/postgresql/data | awk 'NR==2 {print $4}')
    [[ "$estimated" =~ ^[0-9]+$ && "$available" =~ ^[0-9]+$ ]] || return 1
    (( available * 1024 > estimated * 2 + 5368709120 )) || { echo 'Docker盘不足以安全恢复候选快照' >&2; return 1; }
    echo "[staging] thin_bytes=$estimated available_kib=$available"
    echo '[staging] 只读瘦快照 → 独立数据库；任一导出/恢复错误拒绝准入'
    # 与 preview 瘦克隆相同的历史大表排除；schema 和业务事实仍取生产快照。
    docker exec cecelia-node-brain sh -ec '
      test "$DB_NAME" = cecelia
      export PGPASSWORD="$DB_PASSWORD"
      exec pg_dump -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner --no-acl \
        --exclude-table-data=memory_stream --exclude-table-data=cecelia_events \
        --exclude-table-data=alertness_metrics --exclude-table-data=checkpoint_writes \
        --exclude-table-data=checkpoint_blobs --exclude-table-data=checkpoints --exclude-table-data=captures
    ' | docker exec -i "$db" pg_restore --exit-on-error --no-owner --no-acl -U cecelia -d cecelia_staging
    local env_args=(-e DB_HOST=stage-db -e DB_PORT=5432 -e DB_USER=cecelia -e DB_PASSWORD= \
        -e DB_NAME=cecelia_staging -e NODE_ENV=production -e BRAIN_PREVIEW=1 \
        -e CECELIA_TICK_ENABLED=false -e CECELIA_TICK_HARD_OFF=1 -e SKIP_MIGRATIONS=true \
        -e BRAIN_PORT=5222 -e HOME=/tmp)
    echo '[staging] 候选镜像迁移隔离数据库'
    docker run --rm --network "$network" "${env_args[@]}" "$image" node src/migrate.js
    docker run -d --name "$app" --label cecelia.staging=admission-v1 --label "cecelia.staging.request=$request_id" --log-opt max-size=10m --log-opt max-file=2 --network "$network" --read-only --tmpfs /tmp:rw,size=256m \
        -p 127.0.0.1:5222:5222 "${env_args[@]}" \
        --health-cmd 'curl -fsS http://localhost:5222/api/brain/tick/status' \
        --health-interval 5s --health-timeout 5s --health-start-period 40s --health-retries 36 "$image" >/dev/null
    echo '[5/6] 等待候选健康检查'
    local TRIES=0 MAX_TRIES=36 healthy=false state
    while [ $TRIES -lt $MAX_TRIES ]; do
        sleep 5
        TRIES=$((TRIES+1))
        state=$(docker inspect "$app" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')
        if [[ "$state" == healthy ]]; then healthy=true; break; fi
        [[ "$state" != unhealthy ]] || break
    done
    [[ "$healthy" == true ]] || { echo '健康检查超时' >&2; return 1; }
    [[ "$(docker inspect "$app" --format '{{.Image}}')" == "$image" ]] || return 1
    # staging-verify.sh 通过容器自身 API 核验，不把宿主端口误当容器 localhost。
    STAGING_CONTAINER="$app" EXPECTED_SHA="$sha" EXPECTED_VERSION="$version" bash "$SCRIPT_DIR/staging-verify.sh"
    stage_receipt success
    echo "STAGING_VERIFIED sha=$sha image=$image request=$request_id"
)
