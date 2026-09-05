---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 判定器金标集 v0 + eval 通过率棘轮进 CI

**范围**: `tests/gp/f1/`（金标集 v0 fixtures + eval 计分模块 + 永久回归用例）+ `scripts/ratchet-registry.json` / `scripts/ratchet-guard.mjs`（追加 golden_eval_pass_rate 只升不降水位）+ `.github/workflows/golden-eval-ratchet.yml`。**不触碰** `packages/brain/src` 判定器代码（judge 只读被调用）。
**大小**: M

## Invariant 覆盖（铁律三源映射）

- **INV-1 [fail-closed 禁假绿]**（NFR）→ 由 **B-04** 把守：视觉/判定返回 null 一律判 FAIL，evalGoldenSet 中 null 永不计正确。
- **INV-2 [缓存零视觉·防成本回归]**（NFR）→ 由 **B-03** 把守：缓存命中二次判定视觉调用计数 == 0。
- **INV-3 [阈值单调·只升不降]**（NFR）→ 由 **B-02** 把守：降阈提交被 assertMonotonic / 棘轮拦截。
- **INV-4 [契约完备]**（NFR）→ 由 **B-05** 把守：技能契约缺 pre/post/side_effects 任一段 lint FAIL。
- **INV [DIRTY-rebase]**（铁律 area）→ **N/A**：本 sprint 不触及 PR 冲突路由 / generator-fix。
- **INV [凭据不混用]**（铁律 area）→ **N/A**：本 sprint 无跨账号凭据 / 他人资源操作。

## ARTIFACT 条目

- [ ] [ARTIFACT] eval 计分模块存在且导出七个符号（EVAL_STEPS/evalGoldenSet/failClosedJudge/cachedJudge/checkRatchet/assertMonotonic/lintSkillContract）
  Test: node -e "const c=require('fs').readFileSync('tests/gp/f1/eval/harness-visual-eval.mjs','utf8');for(const k of ['EVAL_STEPS','evalGoldenSet','failClosedJudge','cachedJudge','checkRatchet','assertMonotonic','lintSkillContract']){if(!c.includes(k))process.exit(1)}"

- [ ] [ARTIFACT] 金标集 v0 manifest 存在且五类标注齐全（1 true / 4 false，每条 id+screenshot+label）
  Test: node -e "const m=require('./tests/gp/f1/fixtures/golden-set-v0/manifest.json');if(m.length!==5)process.exit(1);const t=m.filter(e=>e.label==='true').length,f=m.filter(e=>e.label==='false').length;if(t!==1||f!==4)process.exit(1);for(const e of m){if(!e.id||!e.screenshot||!e.label)process.exit(1)}"

- [ ] [ARTIFACT] 阈值基线文件存在且 min_pass_rate 为数值（fail-closed 依据）
  Test: node -e "const t=require('./tests/gp/f1/fixtures/golden-set-v0/threshold.json');if(typeof t.min_pass_rate!=='number'||t.min_pass_rate<0||t.min_pass_rate>1)process.exit(1)"

- [ ] [ARTIFACT] 棘轮台账追加 golden_eval_pass_rate（only_up），既有 5 项不删
  Test: node -e "const r=require('./scripts/ratchet-registry.json');const g=r.find(x=>x.name==='golden_eval_pass_rate');if(!g||g.direction!=='only_up'||typeof g.watermark!=='number')process.exit(1);if(r.length<6)process.exit(1)"

- [ ] [ARTIFACT] CI eval workflow 存在且引用 runner + tests/gp/f1 + pull_request 触发
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/golden-eval-ratchet.yml','utf8');if(!/run-golden-eval|tests\/gp\/f1/.test(c)||!/pull_request/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 4 条纯代码用例已 port 进 tests/gp/f1/ 作永久 CI 回归
  Test: node -e "const c=require('fs').readFileSync('tests/gp/f1/step5-golden-eval-ratchet.test.js','utf8');for(const k of ['序列固化','缓存','fail-closed','契约']){if(!c.includes(k))process.exit(1)}"

## BEHAVIOR 条目（真调被改边，judge/视觉为注入外层边界；见合同「禁 mock 边清单」）

- [ ] [BEHAVIOR] [L2] B-01: eval 金标集 v0 通过率可算出且 ≥ 入库阈值
  动作: 用内联 5 条金标集 + 完美参考判定调 evalGoldenSet，读回 {total,correct,passRate}
  预期观察: total=5、correct=5、passRate=1.0 ≥ 阈值 0.8，用例通过
  等待预算: 0s
  留证: /tmp/golden-eval-e2e.log（含该用例 passed 行）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && O=$(npx vitest run sprints/09052347-kernel-a54539fd/tests/golden-eval-gate.test.ts -t "通过率可算出" --reporter=basic 2>&1); echo "$O" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$O" | grep -qE "[1-9][0-9]* failed" || { echo "FAIL B-01"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-02: 降阈提交被棘轮拦截（阈值只升不降）
  动作: 调 checkRatchet 三档（恰等/更高/更低）+ assertMonotonic(100,80) / (100,100) / (100,120)
  预期观察: 更低 ok=false；恰等 ok=true bumped=false；更高 ok=true bumped=true newWatermark=120；assertMonotonic 降值抛错、平/升返回新值
  等待预算: 0s
  留证: /tmp/golden-eval-e2e.log（含该用例 passed 行）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && O=$(npx vitest run sprints/09052347-kernel-a54539fd/tests/golden-eval-gate.test.ts -t "降阈提交被棘轮拦截" --reporter=basic 2>&1); echo "$O" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$O" | grep -qE "[1-9][0-9]* failed" || { echo "FAIL B-02"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-03: 缓存命中二次判定视觉调用计数为 0（防成本回归）
  动作: cachedJudge 包裹 spy 判定器，对同一条截图连续判定两次，数 spy 调用增量
  预期观察: 首次 spy 调用 1 次，二次同输入增量为 0，cached.visionCallCount==1
  等待预算: 0s
  留证: /tmp/golden-eval-e2e.log（含该用例 passed 行）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && O=$(npx vitest run sprints/09052347-kernel-a54539fd/tests/golden-eval-gate.test.ts -t "缓存命中二次判定视觉调用计数为 0" --reporter=basic 2>&1); echo "$O" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$O" | grep -qE "[1-9][0-9]* failed" || { echo "FAIL B-03"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-04: 视觉返回 null 必 fail-closed 判 FAIL（不假绿）
  动作: failClosedJudge 包裹恒返 null 的判定器判一条；再用恒 null 判定器跑整集 evalGoldenSet
  预期观察: 单条返回 'FAIL'；整集 correct=0、passRate=0、failures 覆盖全部 5 条，绝不假绿
  等待预算: 0s
  留证: /tmp/golden-eval-e2e.log（含该用例 passed 行）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && O=$(npx vitest run sprints/09052347-kernel-a54539fd/tests/golden-eval-gate.test.ts -t "视觉返回 null 必 fail-closed" --reporter=basic 2>&1); echo "$O" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$O" | grep -qE "[1-9][0-9]* failed" || { echo "FAIL B-04"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-05: 契约缺 pre/post/side_effects 任一段触发 lint FAIL
  动作: lintSkillContract 分别喂完整契约 / 缺 side_effects / side_effects 为空串
  预期观察: 完整 ok=true；缺段 ok=false 且 missing 含 'side_effects'；空段同样 ok=false
  等待预算: 0s
  留证: /tmp/golden-eval-e2e.log（含该用例 passed 行）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && O=$(npx vitest run sprints/09052347-kernel-a54539fd/tests/golden-eval-gate.test.ts -t "契约缺 pre/post/side_effects" --reporter=basic 2>&1); echo "$O" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$O" | grep -qE "[1-9][0-9]* failed" || { echo "FAIL B-05"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-06: 判定步骤序列固化不漂移
  动作: 读 EVAL_STEPS 常量，与冻结的 6 步期望序列逐项 deepEqual
  预期观察: EVAL_STEPS === [load_manifest,validate_labels,judge_each,compare_labels,compute_pass_rate,ratchet_check]，顺序不漂移
  等待预算: 0s
  留证: /tmp/golden-eval-e2e.log（含该用例 passed 行）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && O=$(npx vitest run sprints/09052347-kernel-a54539fd/tests/golden-eval-gate.test.ts -t "判定步骤序列固化不漂移" --reporter=basic 2>&1); echo "$O" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$O" | grep -qE "[1-9][0-9]* failed" || { echo "FAIL B-06"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-07: 金标集为空/标签缺失 → eval 直接 FAIL（不空跑判绿）
  动作: evalGoldenSet 分别喂空 manifest、喂缺 label 的条目
  预期观察: 两种输入均抛错（eval 拒绝空跑判绿），退出非零
  等待预算: 0s
  留证: /tmp/golden-eval-e2e.log（含该用例 passed 行）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && O=$(npx vitest run sprints/09052347-kernel-a54539fd/tests/golden-eval-gate.test.ts -t "金标集为空" --reporter=basic 2>&1); echo "$O" | grep -qE "Tests +[1-9][0-9]* passed" && ! echo "$O" | grep -qE "[1-9][0-9]* failed" || { echo "FAIL B-07"; exit 1; }; echo OK'
