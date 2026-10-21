#!/usr/bin/env bash
# HTTP 只读状态来自部署进程的同SHA/同镜像/隔离实读；空闲与跳过不是通过。
set -euo pipefail
: "${BRAIN_URL:?}" "${EXPECTED_SHA:?}" "${STAGING_REQUEST_ID:?}"
[[ "$EXPECTED_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 1
deadline=$(( $(date +%s) + 5700 ))
for ((poll=0;poll<570;poll++)); do
    [[ $(date +%s) -lt $deadline ]] || break
    remaining=$((deadline - $(date +%s)))
    request_budget=15; ((remaining >= 15)) || request_budget=$remaining
    response=$(curl -fsS --connect-timeout 10 --max-time "$request_budget" "$BRAIN_URL/api/brain/deploy/staging/status")
    [[ $(date +%s) -lt $deadline ]] || break
    status=$(printf '%s' "$response" | jq -r '.status')
    if [[ "$status" == success ]]; then
        printf '%s' "$response" | jq -e --arg sha "$EXPECTED_SHA" --arg request "$STAGING_REQUEST_ID" '.request_id==$request and .sha==$sha and .isolated==true and (.image_id|test("^sha256:[a-f0-9]{64}$"))'
        exit
    fi
    [[ "$status" == running ]] || { echo "staging未验证：$status" >&2; exit 1; }
    remaining=$((deadline - $(date +%s)))
    [[ $remaining -gt 0 ]] || break
    ((remaining > 10)) && remaining=10
    sleep "$remaining"
done
exit 1
