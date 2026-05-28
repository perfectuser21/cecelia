contract_branch: direct
workstream_index: 1
sprint_dir: sprints/harness-xian-codex-spawn

# DoD — ws1: spawnCodexBridgeDetached

## [BEHAVIOR] 导出检查
- Criteria: spawnCodexBridgeDetached 可从 packages/brain/src/spawn/detached.js 导出，类型为 function
- Test: manual:bash -c 'node -e "import(\"./packages/brain/src/spawn/detached.js\").then(m => { if (typeof m.spawnCodexBridgeDetached !== \"function\") throw new Error(\"not a function\"); console.log(\"OK\"); })"'

## [BEHAVIOR] payload 字段
- Criteria: POST 到 bridgeUrl 的请求体包含 task_id、task_type、callback_url
- Test: vitest (unit mock)

## [BEHAVIOR] 非 200 时 throw
- Criteria: Bridge 返回非 200 HTTP 状态时，函数抛出错误（供上层 catch fallback）
- Test: vitest (unit mock)

## [BEHAVIOR] 响应 schema 校验
- Criteria: 响应必须含 status="accepted"（字符串）且 job_id 为 string，否则 throw
- Test: vitest (unit mock)

## [ARTIFACT]
- packages/brain/src/spawn/detached.js 导出 spawnCodexBridgeDetached
