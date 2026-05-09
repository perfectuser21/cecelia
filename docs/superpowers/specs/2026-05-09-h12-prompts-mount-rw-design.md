# H12 — docker-executor cecelia-prompts mount ro→rw

**日期**: 2026-05-09
**状态**: design APPROVED
**Sprint**: langgraph-contract-enforcement / Stage 1 supplement-2（v13 实测暴露）
**Brain task**: 8524336a-ca02-4ad0-a276-26add50f6706

---

## 1. 背景

W8 v13 11 nodes terminal_fail，evaluate 4 次 FAIL 重试后挂。诊断：sub-graph state `pr_url=null`、`generator_output="completed"`，意味着 brain 收的 callback body 里 stdout 是空（generator 创没创 PR 看不见）。

进一步追踪：`packages/brain/src/docker-executor.js:314` 把 `cecelia-prompts` mount 成 `:ro` (read-only)：

```js
'-v', `${HOST_PROMPT_DIR}:/tmp/cecelia-prompts:ro`,
```

H7 (PR #2852) 改 `entrypoint.sh` `tee "$STDOUT_FILE"` 写到 `/tmp/cecelia-prompts/${TASK_ID}.stdout`，但写到 `:ro` mount 直接被 OS 拒。tee 写失败被 `2>&1` 合到 stdout 然后被 pipe 读光（pipe 已经分流给 tee，tee 没读到反向数据），PIPESTATUS[0] 取 claude exit code 不报 tee 错。

后果：H7 在生产容器是 noop，callback body `stdout=""`，brain 永远看不到 generator 真产出，evaluator 永远找不到 PR URL/产物文件 → evaluate FAIL 死循环。

**H7 unit test 用 mkdtemp 临时目录跑 mock claude，没 :ro mount → 测试 PASS 但生产挂**。又一个 "vitest mock ≠ 真行为" 盲区。

## 2. 修法

`packages/brain/src/docker-executor.js:314`：`:ro` 改 `:rw`。

```js
'-v', `${HOST_PROMPT_DIR}:/tmp/cecelia-prompts:rw`,
```

效果：容器内 entrypoint.sh `tee "$STDOUT_FILE"` 能真写文件 → callback body 含 claude stdout → brain 真看到 generator 产出。

## 3. 安全分析

cecelia-prompts 目录承载：
- `<TASK_ID>.prompt`（brain 写，容器读）— 容器读完无需保护写
- `<TASK_ID>.stdout`（**容器写**，brain 读）— H7 设计意图，必须 rw
- `<TASK_ID>.cid`（容器写 cidfile，brain 读）— 已有此用法

容器内 entrypoint.sh + claude（受信子进程）写 prompts 目录无安全风险。容器是受 brain spawn 的，不是 attack surface。

`:rw` 比 `:ro` 多放出的能力：容器能改 prompt / cid 文件。但：
- prompt 文件 brain 写完即 spawn 容器 → spawn 时 prompt 文件已 lock 在 brain memory，容器改它对当次 spawn 无影响
- cid 文件本来就是容器自己写的（detached spawn 不写 cid，attached spawn 写 cid 给 brain 读 PID）

结论：`:rw` 安全。

## 4. 测试策略

按 Cecelia 测试金字塔：H12 是 trivial wrapper（单行配置改动），但行为对 brain ↔ container ↔ callback 链路 critical（H7 真生效的前提）→ 加 unit test 兜住。

### 测试

`tests/brain/h12-prompts-mount-rw.test.js`（vitest，新增）：

- **A. buildDockerArgs 输出含 `:rw` mount，不含 `:ro` mount**
  - 调 buildDockerArgs(opts)
  - grep args 数组里 `cecelia-prompts:` 字段
  - 期望含 `:rw`，不含 `:ro`

不做 docker E2E（CI 没 docker runtime）；W8 v14 真跑兜 integration（合并后手动）。

## 5. DoD

- [BEHAVIOR] buildDockerArgs 输出的 cecelia-prompts mount 字段是 `:rw`
  Test: tests/brain/h12-prompts-mount-rw.test.js
- [ARTIFACT] docker-executor.js 不含 `cecelia-prompts:ro`，含 `cecelia-prompts:rw`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8');if(c.includes('cecelia-prompts:ro'))process.exit(1);if(!c.includes('cecelia-prompts:rw'))process.exit(1)"
- [ARTIFACT] 测试文件存在
  Test: manual:node -e "require('fs').accessSync('tests/brain/h12-prompts-mount-rw.test.js')"

## 6. 合并后真实证（手动）

1. brain redeploy（`docker compose down node-brain && docker compose up -d node-brain`）
2. 跑 W8 v14 一个 sub_task generator 容器
3. `cat /Users/administrator/claude-output/cecelia-prompts/ws1.stdout` 含 claude 完整输出（不再不存在）
4. PG 查 sub-graph state.pr_url 非 null（generator 创了 PR）
5. evaluator 不再 4 次 FAIL，evaluate verdict=PASS

## 7. 不做（明确范围）

- ❌ 不动 entrypoint.sh（H7 改对了，只是被 mount ro 抵消）
- ❌ 不动 spawn/detached.js（mount 来自 buildDockerArgs，间接生效）
- ❌ 不引入新 mount target（cecelia-prompts 一处 rw 即可）
- ❌ 不动 H7/H9/H8/H10/H11 已合 PR
