#!/usr/bin/env bash

DRAIN_TIMEOUT_SECS="${DRAIN_TIMEOUT_SECS:-120}"
BRAIN_DEPLOY_DRAIN_ID=''

brain_previous_container_state() {
    local names state
    names=$(docker container ls -a --filter 'name=^/cecelia-node-brain$' --format '{{.Names}}') || return 1
    if [[ -z "$names" ]]; then
        printf 'absent\n'
        return 0
    fi
    [[ "$names" == cecelia-node-brain ]] || return 1
    state=$(docker inspect --format '{{.State.Status}}' cecelia-node-brain) || return 1
    case "$state" in
        running) printf 'running\n' ;;
        exited|created) printf 'stopped\n' ;;
        *) return 1 ;;
    esac
}

brain_drain_response() {
    node -e '
      const [mode,expected]=process.argv.slice(1);
      let text="";process.stdin.setEncoding("utf8");
      process.stdin.on("data",part=>text+=part);
      process.stdin.on("end",()=>{
        try{
          const value=JSON.parse(text);
          if(!value||typeof value!=="object"||Array.isArray(value))throw Error();
          if(mode==="cancel"){
            if(value.success!==true||value.draining===true)throw Error();
            if(Object.hasOwn(value,"drain_id")&&value.drain_id!==expected)throw Error();
            return;
          }
          if(value.protocol!=="brain-process-drain-v1"||value.draining!==true)throw Error();
          if(typeof value.drain_id!=="string"||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.drain_id))throw Error();
          if(mode==="start"&&value.already_draining===true)throw Error();
          if(expected&&value.drain_id!==expected)throw Error();
          if(typeof value.safe_to_swap!=="boolean"||!Number.isSafeInteger(value.remaining)||value.remaining<0)throw Error();
          if(!Array.isArray(value.blockers)||value.blockers.length!==value.remaining)throw Error();
          if(!Number.isSafeInteger(value.independent_task_count)||value.independent_task_count<0)throw Error();
          if(value.safe_to_swap!==(value.remaining===0))throw Error();
          process.stdout.write(`${value.safe_to_swap?"ready":"waiting"} ${value.drain_id}`);
        }catch{
          process.stderr.write("排空响应的协议、身份或就绪证据不符\n");process.exitCode=1;
        }
      });
    ' "$1" "${2:-}"
}

drain_cancel_with_retry() {
    local drain_id="${1:-$BRAIN_DEPLOY_DRAIN_ID}" response attempt
    [[ "$drain_id" =~ ^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$ ]] || {
        echo '  [drain] 缺少本次排空身份，拒绝取消其它暂停' >&2
        return 1
    }
    for attempt in 1 2 3 4 5; do
        if response=$(curl -sf --max-time 5 -X POST \
            -H 'Content-Type: application/json' --data "{\"drain_id\":\"$drain_id\"}" \
            'http://localhost:5221/api/brain/tick/drain-cancel') \
            && printf '%s' "$response" | brain_drain_response cancel "$drain_id"; then
            echo "  [drain] 本次排空已解除（第 ${attempt} 次尝试）"
            [[ "$BRAIN_DEPLOY_DRAIN_ID" != "$drain_id" ]] || BRAIN_DEPLOY_DRAIN_ID=''
            return 0
        fi
        [[ "$attempt" == 5 ]] || sleep 5
    done
    echo '  [drain] 无法确认本次排空已解除，发布失败' >&2
    return 1
}

brain_drain_failed() {
    echo "  [drain] $1，拒绝切换" >&2
    if [[ -n "$BRAIN_DEPLOY_DRAIN_ID" ]] && ! drain_cancel_with_retry "$BRAIN_DEPLOY_DRAIN_ID"; then
        echo '  [drain] 本次排空恢复未确认，保持发布失败' >&2
    fi
    return 1
}

drain_before_swap() {
    local brain_url='http://localhost:5221' container_state response parsed phase drain_id
    local elapsed=0 started=$SECONDS timeout
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] POST ${brain_url}/api/brain/tick/drain"
        echo "  [dry-run] 校验同一进程排空身份与切换许可"
        return 0
    fi
    [[ "$DRAIN_TIMEOUT_SECS" =~ ^[0-9]+$ ]] || { brain_drain_failed '排空等待预算非法'; return 1; }
    timeout=$((10#$DRAIN_TIMEOUT_SECS))
    # v1 暂停在15分钟后失效；为120秒蓝绿健康检查及恢复留出余量。
    [[ "$timeout" -le 600 ]] || { brain_drain_failed '排空等待预算超过安全切换窗口'; return 1; }
    container_state=$(brain_previous_container_state) || { brain_drain_failed '无法确认旧容器状态'; return 1; }
    if [[ "$container_state" == absent || "$container_state" == stopped ]]; then
        echo '  [drain] 已确认旧 Brain 不在运行，无需等待其进程排空'
        return 0
    fi
    if ! curl -sf --max-time 3 "${brain_url}/api/brain/tick/status" >/dev/null; then
        brain_drain_failed '旧容器运行但 Brain 未响应'
        return 1
    fi
    response=$(curl -sf --max-time 10 -X POST "${brain_url}/api/brain/tick/drain") || {
        brain_drain_failed '排空请求结果未确认'
        return 1
    }
    parsed=$(printf '%s' "$response" | brain_drain_response start) || {
        brain_drain_failed '未取得本次进程排空身份'
        return 1
    }
    read -r phase drain_id <<< "$parsed"
    BRAIN_DEPLOY_DRAIN_ID="$drain_id"
    while [[ "$elapsed" -lt "$timeout" && $((SECONDS - started)) -lt "$timeout" ]]; do
        response=$(curl -sf --max-time 5 "${brain_url}/api/brain/tick/drain-status") || {
            brain_drain_failed '排空状态查询失败'
            return 1
        }
        parsed=$(printf '%s' "$response" | brain_drain_response status "$drain_id") || {
            brain_drain_failed '排空许可的协议、代际或证据已变化'
            return 1
        }
        read -r phase drain_id <<< "$parsed"
        if [[ "$phase" == ready ]]; then
            echo '  [drain] 同一代 Brain 进程已排空，暂停保持，可进入切换'
            return 0
        fi
        sleep 5
        elapsed=$((elapsed + 5))
    done
    brain_drain_failed '等待本机执行排空超时'
}
