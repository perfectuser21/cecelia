#!/usr/bin/env bash
# Loaded by the detached bluegreen sidecar. The old Brain process is SIGKILLed
# with its container, so its EXIT trap cannot restore the persistent tick flag.

bootstrap_sidecar_restore_tick() {
  local outcome="$1"
  [[ "${BRAIN_BOOTSTRAP_RESTORE_TICK:-false}" == true ]] || return 0
  [[ "$outcome" == success || "$outcome" == recovered ]] || return 1
  local binding="${BRAIN_BOOTSTRAP_BINDING_JSON:-}" expected_image expected_sha expected_version
  if [[ "$outcome" == success ]]; then
    expected_image="$PRIMARY_IMAGE"; expected_sha="$EXPECTED_SHA"; expected_version="$BRAIN_VERSION"
  else
    expected_image="$FALLBACK_IMAGE"; expected_sha="$FALLBACK_SHA"; expected_version=1.445.84
  fi
  _sidecar_same_target || return 1
  node -e '
    const r=JSON.parse(process.argv[1]);
    const [outcome,image,sha,version,targetImage,targetSha,primary,fallback]=process.argv.slice(2);
    const key=outcome==="success"?"new":"old";
    const expiry=Date.parse(r.expires_at);
    if(r.schema_version!=="brain-drain-bootstrap/v1"||!Number.isFinite(expiry)
      ||(outcome==="success"&&expiry<=Date.now())
      ||r[`${key}_image_id`]!==image||r[`${key}_git_sha`]!==sha
      ||r[`${key}_version`]!==version||targetImage!==image||targetSha!==sha
      ||r.new_image_id!==primary||r.old_image_id!==fallback
      ||!/^[a-f0-9-]{36}$/.test(r.approval_decision_id)) process.exit(1);
  ' "$binding" "$outcome" "$expected_image" "$expected_sha" "$expected_version" \
    "$TARGET_IMAGE" "$TARGET_SHA" "$PRIMARY_IMAGE" "$FALLBACK_IMAGE" || return 1
  if [[ "$outcome" == success ]]; then bootstrap_sidecar_audit || return 1; fi
  local attempt response status
  for attempt in 1 2 3 4 5; do
    _sidecar_same_target || return 1
    response=$(_sidecar_docker exec "$TARGET_CONTAINER" curl -q -fsm 5 --max-filesize 262144 \
      -X POST http://127.0.0.1:5221/api/brain/tick/enable) || { sleep 5; continue; }
    status=$(_sidecar_docker exec "$TARGET_CONTAINER" curl -q -fsm 5 --max-filesize 262144 \
      http://127.0.0.1:5221/api/brain/tick/status) || { sleep 5; continue; }
    if node -e 'const a=JSON.parse(process.argv[1]),b=JSON.parse(process.argv[2]);
      if(a.success!==true||a.enabled!==true||b.enabled!==true||b.loop_running!==true||b.draining!==false) process.exit(1)' \
      "$response" "$status" && _sidecar_same_target; then
      echo '[sidecar] bootstrap tick 已在固定容器读回 enabled=true'
      return 0
    fi
    sleep 5
  done
  return 1
}
