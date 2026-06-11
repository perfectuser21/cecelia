# Multiline-Curl-Jq Fixture — 反斜杠续行多行 pipeline（盲区 A）

> 永久回归样本：取自生产 run c0e2546b（notion-mapping-fix 合同 Step 1）。
> `curl ... \` 续行后 `| jq -e ...` 在【同一逻辑语句】里，但按物理行扫描只看见首行 curl
> → 误报 weak-oracle/curl-no-jq。逻辑行归一（合并反斜杠续行）后该误报消失，gate 应全过。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] POST /api/brain/notes 带 initiative_id → 201 + url 是 string
  Test:
```bash
curl -sf -X POST localhost:5221/api/brain/notes \
  -H "Content-Type: application/json" \
  -d '{"title":"[contract-e2e] notes 修复验证","content":"E2E 正文","type":"Note","initiative_id":"test-init-id-e2e"}' \
  | tee /tmp/e2e_step1.json \
  | jq -e '.url | type == "string"' > /dev/null \
  || { echo "FAIL: POST /api/brain/notes 非 2xx 或 url 字段不是 string"; exit 1; }
```
