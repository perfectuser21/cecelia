#!/usr/bin/env bash
# 仅调用方持有共同发布锁时执行。候选仅拿隔离数据库，不继承生产凭据或挂载。
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/brain-candidate-docker.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/brain-snapshot.sh"
brain_release_lock() {
    mkdir -p "$ROOT_DIR/logs"
    # A deploy-local child inherits the same open-file-description. Reopening would
    # deadlock against its parent; a plain environment flag is never sufficient.
    if ! node -e 'const fs=require("node:fs");try{const fd=fs.fstatSync(9),path=fs.statSync(process.argv[1]);process.exit(fd.isFile()&&fd.dev===path.dev&&fd.ino===path.ino?0:1)}catch{process.exit(1)}' "$ROOT_DIR/logs/brain-release.lock"; then
        exec 9>"$ROOT_DIR/logs/brain-release.lock"
    fi
    flock -x 9
    # 旧Brain自杀会释放FD9；固定sidecar仍运行时，切换事务尚未收尾。
    # 只读状态；查询失败也拒绝候选，不停止或接管sidecar。
    local active_sidecar
    active_sidecar=$(docker ps --filter 'name=^/cecelia-bluegreen-sidecar$' --filter status=running --format '{{.Names}}') || return 1
    [[ -z "$active_sidecar" ]] || { echo '蓝绿sidecar仍在切换，拒绝候选准入' >&2; return 1; }
}

stage_remove_container() {
    local name="$1" existing
    case "$name" in cecelia-admission-db|cecelia-admission-brain) ;; *) return 1;; esac
    existing=$(candidate_docker ps -a --filter "name=^/$name$" --format '{{.Names}}') || return 1
    [[ -z "$existing" || "$existing" == "$name" ]] || return 1
    if [[ "$existing" == "$name" ]]; then
        [[ "$(candidate_docker inspect "$name" --format '{{index .Config.Labels "cecelia.staging"}}')" == admission-v1 ]] || return 1
        if [[ -n "${1:-}" && -n "${2:-}" ]]; then
            [[ "$(candidate_docker inspect "$name" --format '{{index .Config.Labels "cecelia.staging.request"}}')" == "$2" ]] || return 1
        fi
        candidate_docker stop "$name" >/dev/null || return 1
        candidate_docker rm -v "$name" >/dev/null || return 1
    fi
}

stage_remove_network() {
    local existing
    existing=$(candidate_docker network ls --filter name=cecelia-admission --format '{{.Name}}') || return 1
    if printf '%s\n' "$existing" | grep -qx cecelia-admission; then
        [[ "$(candidate_docker network inspect cecelia-admission --format '{{index .Labels "cecelia.staging"}}')" == admission-v1 ]] || return 1
        if [[ -n "${1:-}" ]]; then
            [[ "$(candidate_docker network inspect cecelia-admission --format '{{index .Labels "cecelia.staging.request"}}')" == "$1" ]] || return 1
        fi
        candidate_docker network rm cecelia-admission >/dev/null || return 1
    fi
}

stage_receipt() {
    local status="$1"
    STAGE_STATUS="$status" SHA="$sha" IMAGE="$image" VERSION="$version" STAGE_REQUEST="$request_id" STAGE_PHASE="${phase:-preflight}" STAGE_EXIT="${exit_status:-0}" VERIFY_FILE="$verification_file" CANDIDATE_OWNERSHIP="${BRAIN_CANDIDATE_OWNERSHIP_FILE:-}" STAGE_TIMINGS="${timing_entries:-}" node -e '
      const fs=require("fs"),p=process.argv[1],e=process.env;const stages={};for(const item of e.STAGE_TIMINGS.split(",").filter(Boolean)){const [name,ms]=item.split(":");stages[name]={duration_ms:(stages[name]?.duration_ms||0)+Number(ms)};}
      fs.writeFileSync(p+".new",JSON.stringify({timings:{request_id:e.STAGE_REQUEST,sha:e.SHA,stages},candidate_ownership_file:e.CANDIDATE_OWNERSHIP,status:e.STAGE_STATUS,request_id:e.STAGE_REQUEST,sha:e.SHA,image_id:e.IMAGE,version:e.VERSION,phase:e.STAGE_PHASE,exit_code:Number(e.STAGE_EXIT),isolated:e.STAGE_STATUS==="success",database:fs.existsSync(e.VERIFY_FILE)?JSON.parse(fs.readFileSync(e.VERIFY_FILE,"utf8")):null,verified_at:new Date().toISOString()}));fs.renameSync(p+".new",p);
    ' "$ROOT_DIR/logs/brain-staging-receipt.json"
}

stage_candidate() (
    set -euo pipefail
    # 已有子 shell 隔离；EXIT trap 所需变量不能在末尾函数返回时随 local 作用域消失。
    sha="$1" image="$2" version="$3"
    [[ "$sha" =~ ^[a-f0-9]{40}$ && "$image" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
    network=cecelia-admission db=cecelia-admission-db app=cecelia-admission-brain
    local postgres_image=pgvector/pgvector:pg17
    request_id="${STAGING_REQUEST_ID:-$(node -e 'process.stdout.write(require("crypto").randomUUID())')}"
    [[ "$request_id" =~ ^[a-f0-9-]{36}$ ]] || return 1
    phase=preflight exit_status=0 timing_entries= timing_phase=
    verification_file="$ROOT_DIR/logs/brain-staging-$request_id.database.json"
    stage_receipt running
    trap 'exit_status=$?; stage_timing_end || true; if [[ "$exit_status" != 0 ]]; then stage_timing_begin cleanup || true; stage_remove_container "$app" "$request_id" || true; stage_remove_container "$db" "$request_id" || true; stage_remove_network "$request_id" || true; stage_timing_end || true; stage_receipt failed || true; fi; candidate_image_cleanup "$sha" "$image" || echo "候选副本未回收，保留检查" >&2; exit "$exit_status"' EXIT
    trap 'exit 143' TERM
    trap 'exit 130' INT
    local actual_sha
    actual_sha=$(candidate_docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$image" | sed -n 's/^GIT_SHA=//p')
    [[ "$actual_sha" == "$sha" ]] || { echo '候选镜像 SHA 不符' >&2; return 1; }
    # 同一锁覆盖候选准备和生产切换；独立 staging 入口也持有这把锁。
    stage_remove_container "$app"
    stage_remove_container "$db"
    stage_remove_network
    # 根盘仅保留少量日志；克隆流不落根盘。Docker数据盘保留5GiB及两倍实际完整快照预算。
    local root_free
    root_free=$(df -Pk "$ROOT_DIR" | awk 'NR==2 {print $4}')
    [[ "$root_free" =~ ^[0-9]+$ && "$root_free" -ge 524288 ]] || { echo '根盘空间不足，禁止候选克隆' >&2; return 1; }
    phase=database-start
    candidate_docker network create --internal --label cecelia.staging=admission-v1 --label "cecelia.staging.request=$request_id" "$network" >/dev/null
    # 内部网络不发布数据库端口，trust 仅在本次独立容器内；不创建/改动生产角色。
    candidate_docker run -d --name "$db" --label cecelia.staging=admission-v1 --label "cecelia.staging.request=$request_id" --log-opt max-size=10m --log-opt max-file=2 --network "$network" --network-alias stage-db \
        -e POSTGRES_USER=cecelia -e POSTGRES_DB=cecelia_staging -e POSTGRES_HOST_AUTH_METHOD=trust \
        "$postgres_image" >/dev/null
    local ready=false n
    for n in $(seq 1 60); do
        if candidate_docker exec "$db" pg_isready -h 127.0.0.1 -U cecelia -d cecelia_staging >/dev/null 2>&1; then ready=true; break; fi
        sleep 2
    done
    [[ "$ready" == true ]] || { echo '隔离数据库未就绪' >&2; return 1; }
    stage_snapshot_restore
    local env_args=(-e DB_HOST=stage-db -e DB_PORT=5432 -e DB_USER=cecelia -e DB_PASSWORD= \
        -e DB_NAME=cecelia_staging -e NODE_ENV=production -e BRAIN_PREVIEW=1 \
        -e CECELIA_TICK_ENABLED=false -e CECELIA_TICK_HARD_OFF=1 -e SKIP_MIGRATIONS=true \
        -e BRAIN_PORT=5222 -e HOME=/tmp)
    echo '[staging] 候选镜像迁移隔离数据库'
    phase=candidate-migration
    stage_timing_begin migration
    candidate_docker run --rm --network "$network" "${env_args[@]}" "$image" node src/migrate.js
    stage_timing_end
    stage_timing_begin health_readback
    phase=candidate-start
    candidate_docker run -d --name "$app" --label cecelia.staging=admission-v1 --label "cecelia.staging.request=$request_id" --log-opt max-size=10m --log-opt max-file=2 --network "$network" --read-only --tmpfs /tmp:rw,size=256m \
        -p 127.0.0.1:5222:5222 "${env_args[@]}" \
        --health-cmd 'curl -fsS http://localhost:5222/api/brain/tick/status' \
        --health-interval 5s --health-timeout 5s --health-start-period 40s --health-retries 36 "$image" >/dev/null
    echo '[5/6] 等待候选健康检查'
    local TRIES=0 MAX_TRIES=36 healthy=false state
    while [ $TRIES -lt $MAX_TRIES ]; do
        sleep 5
        TRIES=$((TRIES+1))
        state=$(candidate_docker inspect "$app" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')
        if [[ "$state" == healthy ]]; then healthy=true; break; fi
        [[ "$state" != unhealthy ]] || break
    done
    [[ "$healthy" == true ]] || { echo '健康检查超时' >&2; return 1; }
    [[ "$(candidate_docker inspect "$app" --format '{{.Image}}')" == "$image" ]] || return 1
    # staging-verify.sh 通过容器自身 API 核验，不把宿主端口误当容器 localhost。
    phase=candidate-readback
    BRAIN_CANDIDATE_DOCKER_CONTEXT="${BRAIN_CANDIDATE_DOCKER_CONTEXT:-}" STAGING_VERIFY_OUTPUT="$verification_file" STAGING_CONTAINER="$app" EXPECTED_SHA="$sha" EXPECTED_VERSION="$version" bash "$SCRIPT_DIR/staging-verify.sh"
    # 同一发布锁内释放本次隔离快照；持久回执保留独立读回，不保留大体积运行资源。
    stage_timing_end
    phase=cleanup
    stage_timing_begin cleanup
    stage_remove_container "$app" "$request_id"
    stage_remove_container "$db" "$request_id"
    stage_remove_network "$request_id"
    candidate_image_cleanup "$sha" "$image" || echo "候选副本未回收，保留检查" >&2
    stage_timing_end
    phase=verified
    stage_receipt success
    echo "STAGING_VERIFIED sha=$sha image=$image request=$request_id"
)
