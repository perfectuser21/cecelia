#!/usr/bin/env bash
# One-time .84 → held-drain protocol bootstrap. Sourced by brain-deploy.sh.

BOOTSTRAP_TICK_DISABLED_BY_DEPLOY=false
BOOTSTRAP_BINDING_JSON=""
BOOTSTRAP_DEFAULT_RECEIPT=/root/.credentials/brain-drain-bootstrap-receipt.json

bootstrap_select_receipt() {
    local candidate="${1:-$BOOTSTRAP_DEFAULT_RECEIPT}"
    [[ -z "${BRAIN_BOOTSTRAP_RECEIPT:-}" && -e "$candidate" ]] || return 0
    [[ -f "$candidate" && ! -L "$candidate" ]] || return 1
    if [[ "$candidate" == "$BOOTSTRAP_DEFAULT_RECEIPT" ]]; then
        local uid
        uid=$(stat -c %u "$candidate") || return 1
        [[ "$uid" == 0 ]] || { echo '[bootstrap] FAIL: 固定回执不是 root 所有' >&2; return 1; }
    fi
    export BRAIN_BOOTSTRAP_RECEIPT="$candidate"
}

bootstrap_assert_identity() {
    local old_image="$1" new_image="$2" new_sha="$3" new_version="$4"
    local receipt="${BRAIN_BOOTSTRAP_RECEIPT:-}"
    local receipt_mode=""
    if [[ -n "$receipt" && -f "$receipt" && ! -L "$receipt" ]]; then
        receipt_mode=$(stat -c %a "$receipt" 2>/dev/null || stat -f %Lp "$receipt" 2>/dev/null || true)
    fi
    [[ "$receipt_mode" == 600 ]] || {
        echo "[bootstrap] FAIL: 审批回执缺失或权限不是 600" >&2; return 1;
    }
    local health container_health container_identity tick_status old_image_sha new_image_sha actual
    container_identity=$(docker inspect cecelia-node-brain --format '{{.State.Running}} {{.Image}}') || return 1
    [[ "$container_identity" == "true $old_image" ]] || {
        echo "[bootstrap] FAIL: 旧生产容器运行状态或镜像已变化" >&2; return 1;
    }
    health=$(curl -sf --max-time 10 http://localhost:5221/api/brain/health) || return 1
    container_health=$(docker exec cecelia-node-brain curl -sf --max-time 10 \
        http://127.0.0.1:5221/api/brain/health) || return 1
    tick_status=$(curl -sf --max-time 10 http://localhost:5221/api/brain/tick/status) || return 1
    node -e 'const x=JSON.parse(process.argv[1]); if(x.enabled!==true||x.loop_running!==true) process.exit(1)' "$tick_status" || {
        echo "[bootstrap] FAIL: 旧 Brain tick 原状态不是运行中" >&2; return 1;
    }
    old_image_sha=$(docker image inspect "$old_image" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^GIT_SHA=//p' | head -1) || return 1
    new_image_sha=$(docker image inspect "$new_image" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^GIT_SHA=//p' | head -1) || return 1
    actual=$(node -e '
      const h=JSON.parse(process.argv[1]),c=JSON.parse(process.argv[8]);
      process.stdout.write(JSON.stringify({
        old_version:"1.445.84",old_image_id:process.argv[2],old_git_sha:process.argv[3],
        new_version:process.argv[4],new_image_id:process.argv[5],new_git_sha:process.argv[6],
        old_health_version:h.version,old_health_git_sha:h.git_sha,
        old_container_health_version:c.version,old_container_health_git_sha:c.git_sha,
        old_image_git_sha:process.argv[3],new_image_git_sha:process.argv[7],
      }));
    ' "$health" "$old_image" "$old_image_sha" "$new_version" "$new_image" "$new_sha" "$new_image_sha" "$container_health") || return 1
    BOOTSTRAP_BINDING_JSON=$(BOOTSTRAP_ACTUAL_JSON="$actual" node "$SCRIPT_DIR/lib/brain-bootstrap-verify.mjs" "$receipt") || return 1
    echo "[bootstrap] 固定旧/新 image 与 Git SHA 已逐项核对，批准决策=$(node -e 'console.log(JSON.parse(process.argv[1]).approval_decision_id)' "$BOOTSTRAP_BINDING_JSON")"
}

bootstrap_audit() {
    local output report
    output=$(timeout -k 2 60 docker exec -i -e BOOTSTRAP_AUDIT_CLI=1 \
        -e "BOOTSTRAP_ACTUAL_JSON=$BOOTSTRAP_BINDING_JSON" \
        cecelia-node-brain node --input-type=module \
        < "$SCRIPT_DIR/lib/brain-bootstrap-audit.mjs") || {
        echo "[bootstrap] FAIL: 执行/审批审计未通过：$(printf '%s' "$output" | tail -1)" >&2
        return 1
    }
    report=$(printf '%s' "$output" | tail -1)
    node -e 'const x=JSON.parse(process.argv[1]); if(x.safe!==true) process.exit(1)' "$report" || return 1
    echo "[bootstrap] 审计通过：有效租约/待处理回调/活跃 attempt=0，远端执行全为 dead"
}

bootstrap_before_swap() {
    local old_image="$1" new_image="$2" new_sha="$3" new_version="$4"
    local response status
    DRAIN_STARTED_BY_DEPLOY=false
    bootstrap_assert_identity "$old_image" "$new_image" "$new_sha" "$new_version" || return 1
    bootstrap_audit || return 1

    # ACK may be lost after the server commits disable; mark restoration first.
    BOOTSTRAP_TICK_DISABLED_BY_DEPLOY=true
    response=$(curl -sf --max-time 10 -X POST http://localhost:5221/api/brain/tick/disable) || return 1
    node -e 'const x=JSON.parse(process.argv[1]); if(x.enabled!==false) process.exit(1)' "$response" || return 1
    status=$(curl -sf --max-time 10 http://localhost:5221/api/brain/tick/status) || return 1
    node -e 'const x=JSON.parse(process.argv[1]); if(x.enabled!==false||x.loop_running!==false||x.tick_running!==false) process.exit(1)' "$status" || {
        echo "[bootstrap] FAIL: 旧 Brain 尚有 tick 在执行" >&2; return 1;
    }

    response=$(curl -sf --max-time 10 -X POST http://localhost:5221/api/brain/tick/drain) || return 1
    node -e 'const x=JSON.parse(process.argv[1]); if(x.draining!==true||x.already_draining===true) process.exit(1)' "$response" || {
        echo "[bootstrap] FAIL: 排空已由其他调用方持有" >&2; return 1;
    }
    DRAIN_STARTED_BY_DEPLOY=true
    bootstrap_audit || return 1
    echo "[bootstrap] 双次审计通过，旧 .84 已停派发，可进入同镜像 blue-green canary"
}

bootstrap_restore_tick() {
    [[ "$BOOTSTRAP_TICK_DISABLED_BY_DEPLOY" == true ]] || return 0
    local attempt response status cancel
    for attempt in 1 2 3 4 5; do
        if [[ "${DRAIN_STARTED_BY_DEPLOY:-false}" == true ]]; then
            cancel=$(curl -sf --max-time 5 -X POST http://localhost:5221/api/brain/tick/drain-cancel 2>/dev/null || true)
            if ! node -e 'const x=JSON.parse(process.argv[1]); if(x.success!==true) process.exit(1)' "$cancel" 2>/dev/null; then
                sleep 5
                continue
            fi
        fi
        response=$(curl -sf --max-time 5 -X POST http://localhost:5221/api/brain/tick/enable 2>/dev/null || true)
        status=$(curl -sf --max-time 5 http://localhost:5221/api/brain/tick/status 2>/dev/null || true)
        if node -e 'const a=JSON.parse(process.argv[1]),b=JSON.parse(process.argv[2]); if(a.enabled!==true||b.enabled!==true||b.loop_running!==true||b.draining!==false) process.exit(1)' "$response" "$status" 2>/dev/null; then
            BOOTSTRAP_TICK_DISABLED_BY_DEPLOY=false
            echo "[bootstrap] tick 已恢复并读回 enabled=true"
            return 0
        fi
        sleep 5
    done
    echo "[bootstrap] FAIL: tick 恢复未获读回，禁止宣告部署成功" >&2
    return 1
}
