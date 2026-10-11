---
task_id: 142c9ad0-2150-4f03-978c-3dd30ab32ed1
step: evaluate
upstream: ["02-spec.md#Q-1"]
---
# QA 报告（第 3 轮，环境 http://localhost:5301）

<!-- 原文截取自 sprints/10111939-cw-142c9ad0/05-qa-report-r3.md 的 T-1（金丝雀 6，PR #6291）；生成器回归样本，勿改 -->

### T-1
对应: Q-1
verdict: PASS
```command
B=http://localhost:5301; for s in stats stages output publish-status; do r=$(curl -sS -w '\n%{http_code}' "$B/api/brain/runs/$s"); echo "$r"; code=$(echo "$r" | tail -n1); body=$(echo "$r" | sed '$d'); [ "$code" = 404 ] || exit 1; echo "$body" | jq -e --arg s "$s" '.error == ("run not found: " + $s) and (has("pipeline_id")|not) and (has("platforms")|not) and (has("stages")|not)' || exit 1; echo "$body" | grep -q 'invalid input syntax' && exit 1; done; echo ALL_OK
```
```output
{"error":"run not found: stats"}
404
true
{"error":"run not found: stages"}
404
true
{"error":"run not found: output"}
404
true
{"error":"run not found: publish-status"}
404
true
ALL_OK
```
浏览器复核（全新 `browser.newContext()`），截图: qa-r3/q1-runs-stats.png
```command
cd /Users/administrator/worktrees/cecelia-cw/qa-6291-3 && sed -i '' "s#from 'playwright'#from '/Users/administrator/worktrees/cecelia-cw/qa-6291-3/node_modules/playwright/index.mjs'#" /tmp/qa-r3-pw.mjs && node /tmp/qa-r3-pw.mjs; echo exit=$?; ls sprints/10111939-cw-142c9ad0/qa-r3
```
```output
q1-runs-stats 404 {"error":"run not found: stats"} OK
q3-pipelines-not-uuid 400 {"error":"invalid pipeline id: must be a UUID"} OK
exit=0
q1-runs-stats.png
q3-pipelines-not-uuid.png
```

