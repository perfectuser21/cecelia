---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: HOL skip + zombie reaper 段（Steps 4-5）

**范围**: 在 WS1 的 smoke 文件上追加
- Step 4（HOL skip）: 通过填满 codex pool（或等价的"队首被阻塞"构造，需复用 `packages/brain/scripts/smoke/dispatcher-hol-skip-smoke.sh` 中已验过的代码路径），让一个 non-P0 codex 队首 task_A 触发 dispatcher.js:407 的 HOL skip 分支；同时投 task_B/task_C 是可派发的；POST /api/brain/tick；断言 task_A `claimed_by` 被释放（claim 还原），task_B 或 task_C 至少 1 个被 dispatcher 处理（dispatch_events 5 分钟内 +1 行 event_type=`dispatched` 且 task_id IN (B,C)）；smoke 日志含字面值 `HOL skip` 字串（来自 dispatcher.js 真日志，不是 smoke echo 自吹）。
- Step 5（zombie reaper）: 构造 30 分钟 idle 的 `in_progress` task；通过 `import('./packages/brain/src/zombie-reaper.js')` 调 `reapZombies({ idleMinutes: 0 })`；断言 tasks.status='failed' + `error_message` 含字面子串 `[reaper] zombie` + `completed_at` 非空（与 `packages/brain/src/zombie-reaper.js:73-81` 实现一致）。

**大小**: M（≈ 70 LOC 追加）
**依赖**: WS1（smoke 文件骨架必须先存在；BEHAVIOR Test 复用 WS1 的 SSOT smoke 输出缓存 `/tmp/w29-acceptance-smoke.out`）

## SSOT 协议（同 WS1）

evaluator 的 BEHAVIOR Test = 在 SSOT smoke stdout 中 grep 精确分段 PASS 标记。所有 BEHAVIOR Test 共享 `/tmp/w29-acceptance-smoke.out`。

## ARTIFACT 条目

- [ ] [ARTIFACT] smoke 文件含 HOL skip 段（test-w29-hol-A/B/C 任务名 + 触发 codex pool 满或等价构造）
  Test: `bash -c 'grep -q "test-w29-hol-A" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -q "test-w29-hol-B" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -q "test-w29-hol-C" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

- [ ] [ARTIFACT] smoke 文件含 zombie 段（test-w29-zombie task + import zombie-reaper.js + reapZombies({ idleMinutes: 0 }) 调用形式）
  Test: `bash -c 'grep -q "test-w29-zombie" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh && grep -qE "reapZombies\s*\(\s*\{\s*idleMinutes\s*:\s*0" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

- [ ] [ARTIFACT] smoke 文件含字面值 `[reaper] zombie` 子串断言（zombie error_message 验证）
  Test: `bash -c 'grep -q "\[reaper\] zombie" packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh'`
  期望: exit 0

## BEHAVIOR 条目（SSOT — smoke 跑后断言分段 PASS 行存在；evaluator 真执行）

- [ ] [BEHAVIOR] [ws2-b5-hol-task-a-claim-released] B5 invariant: HOL skip 触发后 task_A 的 `claimed_by` 被释放（与 dispatcher.js:408-411 实现一致，HOL skip 路径 UPDATE tasks SET claimed_by=NULL）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B5-A\] PASS — task_A claimed_by 被释放" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws2-b5-task-bc-dispatched] B5 invariant: task_B/task_C 至少 1 条在 5 分钟内进入 dispatch_events 且 event_type=`dispatched`（HOL 没让 task_A 阻塞整个队列）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B5-BC\] PASS — dispatch_events 含 task_(B|C) event_type=dispatched within 5min" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws2-b5-dispatcher-log] B5 invariant: dispatcher.js 真日志含字面值 `HOL skip` 字串（smoke 必须捕获 brain stdout 或读 `packages/brain/logs/` 验，不能 echo 自吹）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B5-LOG\] PASS — dispatcher 真日志含 'HOL skip'" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws2-b2-zombie-reaped-failed] B2 invariant: reapZombies 跑后该 zombie task status='failed' + error_message 含字面子串 `[reaper] zombie` + completed_at IS NOT NULL（与 zombie-reaper.js:73-81 实现一致）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B2\] PASS — reapZombies 标 task=failed error_message='\[reaper\] zombie" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws2-b2-reaper-return-shape] B2 invariant: `reapZombies({idleMinutes:0})` 返回值 shape 严格为 `{reaped:number≥1, scanned:number≥1, errors:array}`（reaped ≥ 1 证明真有 zombie 被标，errors=[] 证明无错；与 zombie-reaper.js:38-39 接口一致）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B2-RET\] PASS — reapZombies returned reaped=[1-9][0-9]* errors=0" "$OUT"'
  期望: exit 0

- [ ] [BEHAVIOR] [ws2-b3-slot-out] B3 invariant: zombie 被 reaper 标 failed 之后，对应 slot 被释放（in_progress 计数相对 reaper 跑前减 1，证明 slot accounting 没漂）
  Test: manual:bash -c 'OUT=/tmp/w29-acceptance-smoke.out; [ -s "$OUT" ] || { bash packages/brain/scripts/smoke/walking-skeleton-p1-acceptance-smoke.sh > "$OUT" 2>&1; echo "exit=$?" >> "$OUT"; }; head -5 "$OUT" | grep -qE "^SKIP:" && exit 0; grep -qE "^\[B3-OUT\] PASS — slot in_progress -1 after zombie reaped" "$OUT"'
  期望: exit 0
