---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: fire-drill 修复 QuickCheck 将真实失败误判为 OOM 后退出 0

**范围**: `scripts/quickcheck.sh` 中 vitest 输出分类优先级修复（明确失败计数优先于 OOM 宽免）+ 永久回归测试
**大小**: S

contract-gate: skipped 检查项不适用（cecelia 场景，`packages/brain/src/lib/contract-gate.js` 存在，走正常代码层 Contract Gate 流程）

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/quickcheck.sh` 分类逻辑新增对 vitest 汇总行失败计数（如 `Tests  N failed`）的检测，不再只靠逐文件 ` FAIL ` 标记
  Test: node -e "const c=require('fs').readFileSync('scripts/quickcheck.sh','utf8'); const s=c.indexOf('VITEST_OUT='); const e=c.indexOf('\ndone', s); const block=c.slice(s,e<0?undefined:e); if(!/failed/i.test(block)) process.exit(1)"

- [ ] [ARTIFACT] 永久回归测试文件 `packages/engine/tests/scripts/quickcheck-oom-priority.test.ts` 存在且覆盖四类场景
  Test: node -e "const c=require('fs').readFileSync('packages/engine/tests/scripts/quickcheck-oom-priority.test.ts','utf8'); const need=['失败计数与 worker OOM 文案同现','仅 worker OOM、无任何失败计数','正常全部 PASS 时','多包混合场景']; for (const n of need) { if(!c.includes(n)) process.exit(1); }"

- [ ] [ARTIFACT] 本次改动未触碰 `packages/brain/src`，无 DB migration 文件
  Test: bash -c 'git diff --name-only origin/main...HEAD 2>/dev/null | grep -E "^packages/brain/src/|migrations/" && exit 1 || exit 0'

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] [L2] 失败计数与 worker OOM 文案同现时，quickcheck 整体退出码非 0
  动作: 对一个改动包，构造 vitest 输出 fixture（含 OOM/worker 异常退出文案 + 汇总行 "Tests  1 failed | 24 passed (25)"，但不含逐文件 " FAIL " 标记），运行修复后的 `scripts/quickcheck.sh`
  预期观察: quickcheck 判定该包为失败，终端打印 `❌ 失败`，整体进程以非 0 退出码结束
  验证命令: Test: manual:bash -c '
    cd packages/engine
    NODE_OPTIONS="--max-old-space-size=2048" \
      node_modules/.bin/vitest run tests/scripts/quickcheck-oom-priority.test.ts -t "失败计数与 worker OOM 文案同现" --reporter=verbose 2>&1 | tee /tmp/qc-b1.log
    grep -qE "1 passed" /tmp/qc-b1.log || { echo "FAIL"; exit 1; }
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] 仅 worker OOM、无任何失败计数时，quickcheck 整体退出码保持 0（宽免不误伤）
  动作: 对一个改动包，构造 vitest 输出 fixture（仅含 OOM/worker 异常退出文案，汇总行 "Tests  42 passed (42)"，vitest 退出码非 0），运行修复后的 `scripts/quickcheck.sh`
  预期观察: quickcheck 判定该包为"预存在环境问题，非代码问题"，终端打印宽免提示，整体退出码为 0
  验证命令: Test: manual:bash -c '
    cd packages/engine
    NODE_OPTIONS="--max-old-space-size=2048" \
      node_modules/.bin/vitest run tests/scripts/quickcheck-oom-priority.test.ts -t "仅 worker OOM、无任何失败计数" --reporter=verbose 2>&1 | tee /tmp/qc-b2.log
    grep -qE "1 passed" /tmp/qc-b2.log || { echo "FAIL"; exit 1; }
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] 正常全部 PASS 时，quickcheck 整体退出码保持 0（不引入新误报）
  动作: 对一个改动包，构造 vitest 输出 fixture（正常全部 PASS，vitest 退出码 0），运行修复后的 `scripts/quickcheck.sh`
  预期观察: quickcheck 判定该包通过，终端打印 `✅ 通过`，整体退出码为 0
  验证命令: Test: manual:bash -c '
    cd packages/engine
    NODE_OPTIONS="--max-old-space-size=2048" \
      node_modules/.bin/vitest run tests/scripts/quickcheck-oom-priority.test.ts -t "正常全部 PASS 时" --reporter=verbose 2>&1 | tee /tmp/qc-b3.log
    grep -qE "1 passed" /tmp/qc-b3.log || { echo "FAIL"; exit 1; }
    echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] 多包混合场景（一个包仅 OOM、另一个包失败+OOM 同现），整体结果以失败为准（顺序无关）
  动作: 构造两个改动包的 fixture 组合（packages/engine=仅OOM；apps/dashboard=失败+OOM同现），运行修复后的 `scripts/quickcheck.sh`
  预期观察: 无论包处理顺序如何，quickcheck 整体判定为失败，整体退出码非 0
  验证命令: Test: manual:bash -c '
    cd packages/engine
    NODE_OPTIONS="--max-old-space-size=2048" \
      node_modules/.bin/vitest run tests/scripts/quickcheck-oom-priority.test.ts -t "多包混合场景" --reporter=verbose 2>&1 | tee /tmp/qc-b4.log
    grep -qE "1 passed" /tmp/qc-b4.log || { echo "FAIL"; exit 1; }
    echo OK'
  期望: OK

## BEHAVIOR:E2E 条目

（本 sprint journey_type=dev_pipeline，非 user_facing，无需 UI 截图；final-e2e 验证复用上方 BEHAVIOR 的四个场景 + `## E2E 验收` 区块的完整脚本，作为 dev_pipeline 场景的 Mode B 等价物）

## INV 铁律覆盖条目

- [ ] [BEHAVIOR] INV-系统-真环境验证才算done：本 sprint 的 [BEHAVIOR] 均在真实 `scripts/quickcheck.sh`（未简化/未 mock 分类逻辑本身）上验证，仅 vitest 二进制本身用 fixture 顶替（见"未覆盖真实链路清单"），非分类逻辑本身被 mock
  Test: manual:bash -c 'grep -q "readFileSync(REAL_SCRIPT" packages/engine/tests/scripts/quickcheck-oom-priority.test.ts && echo OK || exit 1'
- [ ] [BEHAVIOR] INV-系统-禁止写死环境假设值：fixture 中的 vitest 输出格式基于已知真实 vitest 汇总行格式（"Test Files  N failed|passed (M)" / "Tests  N failed|passed (M)"），非凭空捏造的坐标/阈值
  Test: manual:bash -c 'grep -q "Test Files" packages/engine/tests/scripts/quickcheck-oom-priority.test.ts && echo OK || exit 1'
- [ ] [BEHAVIOR] N/A：其余 area 级铁律（capture-triage/agent-offline-alert 相关等）与本次 quickcheck.sh 文本分类修复无关，不触及对应模块
  Test: manual:bash -c 'echo OK'
