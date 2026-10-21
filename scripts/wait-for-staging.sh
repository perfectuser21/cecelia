#!/usr/bin/env bash
# HTTP 只读状态来自部署进程的同SHA/同镜像/隔离实读；空闲与跳过不是通过。
set -euo pipefail
: "${BRAIN_URL:?}" "${EXPECTED_SHA:?}" "${STAGING_REQUEST_ID:?}"
[[ "$EXPECTED_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 1
for ((elapsed=0;elapsed<1200;elapsed+=10)); do
    response=$(curl -fsS --connect-timeout 10 --max-time 15 "$BRAIN_URL/api/brain/deploy/staging/status")
    status=$(printf '%s' "$response" | jq -r '.status')
    if [[ "$status" == success ]]; then
        printf '%s' "$response" | jq -e --arg sha "$EXPECTED_SHA" --arg request "$STAGING_REQUEST_ID" '.request_id==$request and .sha==$sha and .isolated==true and (.image_id|test("^sha256:[a-f0-9]{64}$"))'
        exit
    fi
    [[ "$status" == running ]] || { echo "staging未验证：$status" >&2; exit 1; }
    sleep 10
done
exit 1
