# Capture-Then-Assert Fixture — 跨语句 oracle，curl-no-jq 应放行

> 永久回归样本（生产 run fa2b3e21）：`RESP=$(curl ...)` 捕获响应（本语句仅做失败传播），
> 下一条逻辑语句 `echo "$RESP" | jq -e ...` 做值校验。gate 不应误报 weak-oracle/curl-no-jq，应全过（exit 0）。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 目标任务状态为 completed（捕获后跨语句断言）
  Test: 见下方验收脚本

```bash
RESP=$(curl -sf "localhost:5221/api/brain/tasks/$TARGET_TASK_ID") || { echo "FAIL: 取任务失败"; exit 1; }
echo "$RESP" | jq -e '.status == "completed"' || { echo FAIL; exit 1; }
```
