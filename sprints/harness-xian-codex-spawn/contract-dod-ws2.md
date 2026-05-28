contract_branch: direct
workstream_index: 2
sprint_dir: sprints/harness-xian-codex-spawn

# DoD — ws2: harness-task.graph.js spawnNode HARNESS_XIAN_ENABLED 分支

**范围**: `packages/brain/src/workflows/harness-task.graph.js` 中 `spawnNode` 加 HARNESS_XIAN_ENABLED 特性分支

## [BEHAVIOR] HARNESS_XIAN_ENABLED 严格 === 'true' 检查

- Criteria: HARNESS_XIAN_ENABLED 检查使用严格 === 'true'（不是 truthy，非 == true）
- Test: vitest (unit mock — HARNESS_XIAN_ENABLED='false'/'1' 均走 Docker 路径)

## [BEHAVIOR] spawnNode Bridge 调用含 try/catch + fallback Docker

- Criteria: HARNESS_XIAN_ENABLED='true' 时先调 Bridge；Bridge 抛错则 catch + fallback spawnDockerDetached
- Test: vitest (unit mock — spawnBridgeMock throw → spawnDetached 被调用，run 不中断)

## [BEHAVIOR] HARNESS_XIAN_BRIDGE_URL 环境变量用于 Bridge URL

- Criteria: Bridge 第一参数来自 process.env.HARNESS_XIAN_BRIDGE_URL（不 hardcode）
- Test: vitest (unit mock)

## [BEHAVIOR] callback_url 使用 finalContainerId

- Criteria: Bridge payload 的 callback_url 包含 finalContainerId（与 thread_lookup 对齐）
- Test: vitest (unit mock)

## [BEHAVIOR] opts.spawnBridge DI 接口

- Criteria: spawnNode 第二参数 opts 接受 spawnBridge 覆盖（测试 DI 接口）
- Test: vitest (unit mock — opts.spawnBridge 传入时被调用)

## [ARTIFACT] harness-task.graph.js 含 HARNESS_XIAN_ENABLED 字面量

- Criteria: packages/brain/src/workflows/harness-task.graph.js 文件内含字符串 HARNESS_XIAN_ENABLED
- Test: manual:bash -c 'node -e "const fs=require(\"fs\"); const c=fs.readFileSync(\"./packages/brain/src/workflows/harness-task.graph.js\",\"utf8\"); if (!c.includes(\"HARNESS_XIAN_ENABLED\")) { console.error(\"FAIL: literal not found\"); process.exit(1); } console.log(\"OK: HARNESS_XIAN_ENABLED found\");"'
