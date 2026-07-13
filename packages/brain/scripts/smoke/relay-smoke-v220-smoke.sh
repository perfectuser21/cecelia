#!/usr/bin/env bash
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
response=$(curl -s "$BRAIN_URL/api/brain/relay-smoke")
echo "$response" | jq -e '.ok==true and .controller=="2.2.0"' || { echo "FAIL: $response"; exit 1; }
echo "relay-smoke smoke: PASS"
