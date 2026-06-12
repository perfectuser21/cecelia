#!/bin/bash
BRES=$(cat ".brain-result.json")
echo "$BRES" | jq -e 'has("verdict") and has("coverage")' || { echo "FAIL: 字段缺失"; exit 1; }
echo "$BRES" | jq -e '.verdict == "PASS" or .verdict == "FAIL" or .verdict == "FIXED"' || { echo "FAIL: verdict 不在枚举内"; exit 1; }
echo "$BRES" | jq -e 'has("result") | not' || { echo "FAIL: 禁用字段 result 出现"; exit 1; }
echo "$BRES" | jq -e 'has("records") | not' || { echo "FAIL: 禁用字段 records 出现"; exit 1; }
echo OK
