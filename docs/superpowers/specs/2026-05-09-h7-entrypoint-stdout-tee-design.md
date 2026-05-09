# H7 — entrypoint.sh tee stdout 到 STDOUT_FILE

**日期**: 2026-05-09
**状态**: design APPROVED
**Sprint**: langgraph-contract-enforcement / Stage 1
**Brain task**: 4965a3ef-108b-4f36-8b42-114f531ede99
**接手 PRD**: docs/handoffs/2026-05-09-langgraph-contract-enforcement-prd.md

---

## 1. 背景

Layer 3 spawn-and-interrupt（PR #2845, 2026-04-28）把 harness 容器从 `exec claude` 改成"先跑 claude → 拿 exit_code → POST callback → 退出"。

但 `docker/cecelia-runner/entrypoint.sh:107-113` 的 `run_claude()` 直接让 claude stdout 打到 terminal：

```bash
run_claude() {
  if [[ -f "$PROMPT_FILE" ]]; then
    claude -p ... < "$PROMPT_FILE"        # ← stdout 没 tee 到文件
  else
    claude -p ... "$@"                    # ← 同上
  fi
}
```

detached docker spawn 后无人 attach，stdout 全部丢失。

而第 132 行：

```bash
STDOUT_FILE="/tmp/cecelia-prompts/${CECELIA_TASK_ID}.stdout"
if [[ -f "$STDOUT_FILE" ]]; then
  STDOUT_CONTENT=$(tail -c 4000 "$STDOUT_FILE" 2>/dev/null || echo "")
fi
```

期望从 STDOUT_FILE 读 claude 完整输出，但**没人写这文件** → STDOUT_CONTENT 永远空 → callback body 永远 `{"stdout":""}`。

**后果**：brain 看不到 generator/proposer 容器实际产出（PR URL/commit hash），W8 acceptance 5 次跑全部漏过 contract verification。

## 2. 修法

`docker/cecelia-runner/entrypoint.sh` 改 `run_claude()`，给 claude 调用加 `tee "$STDOUT_FILE"`：

```bash
STDOUT_FILE="/tmp/cecelia-prompts/${CECELIA_TASK_ID:-UNSET}.stdout"

run_claude() {
  if [[ -f "$PROMPT_FILE" ]]; then
    claude -p --dangerously-skip-permissions --output-format json "${MODEL_FLAGS[@]}" < "$PROMPT_FILE" 2>&1 | tee "$STDOUT_FILE"
    return ${PIPESTATUS[0]}
  else
    claude -p --dangerously-skip-permissions --output-format json "${MODEL_FLAGS[@]}" "$@" 2>&1 | tee "$STDOUT_FILE"
    return ${PIPESTATUS[0]}
  fi
}
```

**关键三点**：

1. `2>&1 | tee "$STDOUT_FILE"` — stderr 也合到 stdout 文件，避免错误信息丢
2. `return ${PIPESTATUS[0]}` — 拿 claude 真实 exit code（tee 永远 0，不 PIPESTATUS 会把 claude 失败误判成成功）
3. STDOUT_FILE 定义提到 `run_claude` 之前，让函数体能引用

## 3. 不动什么

- 非 harness 任务（CECELIA_TASK_ID 或 HARNESS_NODE 任一为空）走第 117-123 行 `exec claude` 路径，**完全不变**
- callback body 拼装逻辑（132-145 行）不变
- harness 任务的 `set +e ... run_claude ... EXIT_CODE=$?` 流程不变（但 `$?` 现在是 `${PIPESTATUS[0]}`，已正确）

## 4. 测试策略

按 Cecelia 测试金字塔分类：trivial wrapper（< 20 行无 I/O 的 shell function 改动），但行为对 brain ↔ docker callback 链路 critical → 加一层 unit test 兜住。

### 两层验证

**层 1：ARTIFACT 静态检查（DoD）**
`node -e` 读 entrypoint.sh 验证含 `tee "$STDOUT_FILE"` 和 `PIPESTATUS[0]` 字符串。CI L1 兼容（无外部依赖）。

**层 2：BEHAVIOR unit test**
`tests/docker/entrypoint-stdout-tee.test.js`（vitest），验证两件事：
- mock `claude` 二进制 echo 一段 known stdout → 真写入临时 STDOUT_FILE
- mock `claude` exit 1 → `run_claude` 返回 1（PIPESTATUS 生效，不被 tee 吃掉）

**实现思路**：
- vitest 用 `child_process.execFileSync('bash', ['-c', '...'])` 跑 minimal bash 脚本
- 脚本里：`PATH=$tmpdir:$PATH` 让 mock `claude` 优先；source `entrypoint.sh` 的 `run_claude` 函数；调用并断言 STDOUT_FILE 内容 + 返回码
- 不依赖 docker，不依赖真 claude 二进制 → CI 能跑

### 不做 docker E2E

CI 没 docker runtime（HK runner 已停），smoke.sh 也不跑 docker container 来验证此修复（packages/brain/scripts/smoke/ 里的 smoke 都是 curl/psql/node 链路验证，不起容器）。docker E2E 留给手动 W8 v11 跑通验证。

## 5. DoD（成功标准）

- **[BEHAVIOR]** entrypoint.sh harness 路径下 claude stdout 写入 `/tmp/cecelia-prompts/${CECELIA_TASK_ID}.stdout`
  Test: `tests/docker/entrypoint-stdout-tee.test.js`
- **[BEHAVIOR]** `run_claude` 退出码 = claude 退出码（不被 tee 吃掉）
  Test: `tests/docker/entrypoint-stdout-tee.test.js`
- **[ARTIFACT]** `docker/cecelia-runner/entrypoint.sh` 含 `tee "$STDOUT_FILE"` 和 `${PIPESTATUS[0]}`
  Test: `manual:node -e "const c=require('fs').readFileSync('docker/cecelia-runner/entrypoint.sh','utf8'); if(!/tee \"\\$STDOUT_FILE\"/.test(c)) process.exit(1); if(!c.includes('PIPESTATUS[0]')) process.exit(1)"`

## 6. 合并后真实证（手动）

1. `bash scripts/brain-build.sh` 重新构建 cecelia-runner image
2. brain redeploy（`docker compose down node-brain && docker compose up -d node-brain`）
3. 跑 W8 v11 一个 sub_task 容器
4. `docker exec <container> cat /tmp/cecelia-prompts/$TASK_ID.stdout` 含 claude 完整输出
5. PG 查 `task_events.payload->>'stdout'` 不再是空字符串：

```sql
SELECT payload->>'stdout' FROM task_events
WHERE task_id='<W8_TID>' AND event_type='callback_received'
ORDER BY created_at DESC LIMIT 1;
```

## 7. 不做（明确范围）

- ❌ 不动 callback body 拼装逻辑（132-145 行）
- ❌ 不动非 harness 任务的 exec 路径（117-123 行）
- ❌ 不引入 stdout 流式上传（4000 字节 tail 现状已够）
- ❌ 不做 docker integration E2E（CI 跑不动）
- ❌ 不做 H8/H9/proposer verify push（独立 PR）
