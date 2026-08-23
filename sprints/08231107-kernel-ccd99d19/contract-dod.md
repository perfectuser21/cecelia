---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 投影物化两阶段原子化（capability 节点全部写完再翻转 active）[r54]

**范围**: `packages/brain/src/map/projector.js` 物化改两阶段（`materializing` 中间态 → 单事务翻转 active/superseded）；读取侧 active-only 语义锁定（materializing/building 不可见，superseded 仍可读）；新增 migration 放开 `status` CHECK 纳入 `materializing`；RED/GREEN 回归测试冻结。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 冻结 RED→GREEN 单测文件存在且含 5 个 it()
  Test: node -e "const c=require('fs').readFileSync('sprints/08231107-kernel-ccd99d19/tests/projection-two-phase.test.js','utf8');const n=(c.match(/\bit\(/g)||[]).length;if(n<5){console.error('FAIL: it() 数='+n);process.exit(1)};if(!/materializing/.test(c)){console.error('FAIL: 缺 materializing 断言');process.exit(1)};console.log('OK')"
  期望: OK

- [ ] [ARTIFACT] 新增 migration 把 `materializing` 纳入 `map_projection_runs.status` CHECK（并入 activation_shape 的 activated_at IS NULL 分支）
  Test: node -e "const cp=require('child_process');const g=cp.execSync(\"ls packages/brain/migrations/*.sql\").toString().split('\n').filter(Boolean);const hit=g.find(f=>/materializing/.test(require('fs').readFileSync(f,'utf8')));if(!hit){console.error('FAIL: 无迁移含 materializing');process.exit(1)};console.log('OK '+hit)"
  期望: OK <迁移路径>

- [ ] [ARTIFACT] 真 PG 补位集成测试文件存在（brain-integration CI 跑；禁 mock 边 真库覆盖）
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/map-projection-two-phase.pg.integration.test.js');console.log('OK')"
  期望: OK

- [ ] [ARTIFACT] status 枚举新增值全仓库无遗漏硬编码（invariant [status枚举全查]）—— 除 projector/migration/新测试外，无其它文件把旧枚举写死拦截 materializing
  Test: node -e "const cp=require('child_process');const out=cp.execSync(\"grep -rln \\\"IN ('building', 'active', 'superseded'\\\" packages/brain/src packages/brain/migrations 2>/dev/null || true\").toString().trim();const bad=out.split('\n').filter(f=>f && !/(projector\.js|_map_projection|two-phase)/.test(f));if(bad.length){console.error('FAIL: 遗漏更新的硬编码 status 枚举: '+bad.join(','));process.exit(1)};console.log('OK')"
  期望: OK

## BEHAVIOR 条目（内嵌可执行 manual: 命令；autonomous / local_api / postgres:false → vitest 真跑）

- [ ] [BEHAVIOR] [L1] B-01: 新投影 run 以 materializing 中间态写入（换代窗口内对读者不可见）
  动作: 以录制事务 client 调 `runProjection(...)`，捕获真实发往 Postgres 的 SQL 序列
  预期观察: `INSERT INTO map_projection_runs ... VALUES (...,'materializing')`（当前实现为 `'building'` → RED；实现后 GREEN）
  等待预算: 0s
  留证: vitest stdout（含 `N passed`）；RED 现场 = `expected 'INSERT ... 'building') ...' to match /'materializing'/`
  Test: manual:bash -c '(cd sprints/08231107-kernel-ccd99d19 && npx vitest run --root . tests/projection-two-phase.test.js -t "writes the new run with materializing status" --reporter=basic) 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L1] B-02: 全部 capability 节点/边物化完成后才翻转 active
  动作: 调 `runProjection(...)`，记录 node/edge INSERT 与 active 翻转 UPDATE 的先后索引
  预期观察: 最后一条 `map_projection_nodes/edges` INSERT 索引 < `UPDATE ... status='active'` 索引
  等待预算: 0s
  留证: vitest stdout（含 `N passed`）
  Test: manual:bash -c '(cd sprints/08231107-kernel-ccd99d19 && npx vitest run --root . tests/projection-two-phase.test.js -t "materializes all nodes and edges before the active flip" --reporter=basic) 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L1] B-03: 同一事务内旧 active 置 superseded + 新 run 置 active
  动作: 调 `runProjection(...)`，检查 supersede 与 activate 两条 UPDATE 及其目标
  预期观察: 存在 `UPDATE ... 'superseded' WHERE scope_key=...` 与 `UPDATE ... 'active' WHERE id=<新runId>` 两条，均在物化之后
  等待预算: 0s
  留证: vitest stdout（含 `N passed`）
  Test: manual:bash -c '(cd sprints/08231107-kernel-ccd99d19 && npx vitest run --root . tests/projection-two-phase.test.js -t "supersedes old active and activates new run in one flip" --reporter=basic) 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L1] B-04: active 选择只命中 active，materializing 残行永不可见
  动作: 内存 status-aware 假 pool 同时存在 active(旧) 与 materializing(更新)两行，调 `getActiveProjection(scope)`
  预期观察: 返回 active 行，`status !== 'materializing'`（谓词若泄漏 materializing 则该 it 转红）
  等待预算: 0s
  留证: vitest stdout（含 `N passed`）
  Test: manual:bash -c '(cd sprints/08231107-kernel-ccd99d19 && npx vitest run --root . tests/projection-two-phase.test.js -t "selects only active runs never materializing residuals" --reporter=basic) 2>&1 | grep -qE "[1-9][0-9]* passed"'

- [ ] [BEHAVIOR] [L1] B-05: revision 查找不返回 materializing 残行，但仍可读 superseded
  动作: 假 pool 同一 revision 下存在 superseded 与 materializing 两行，调 `getProjectionForRevision(scope, rev)`
  预期观察: 返回 superseded 行，`status !== 'materializing'`（既不回退 superseded 可读，又不泄漏 materializing）
  等待预算: 0s
  留证: vitest stdout（含 `N passed`）
  Test: manual:bash -c '(cd sprints/08231107-kernel-ccd99d19 && npx vitest run --root . tests/projection-two-phase.test.js -t "never returns a materializing residual run" --reporter=basic) 2>&1 | grep -qE "[1-9][0-9]* passed"'

## Invariant 覆盖（历史约束三源逐条映射）

- [ ] [BEHAVIOR] INV-1 [Test Contract格式] Test Contract 表 4 列、testFile backtick 包裹、第 3 列为路径
  Test: manual:bash -c 'grep -q "testFile" sprints/08231107-kernel-ccd99d19/contract-draft.md && grep -qF "sprints/08231107-kernel-ccd99d19/tests/projection-two-phase.test.js" sprints/08231107-kernel-ccd99d19/contract-draft.md && echo OK'
- [ ] [BEHAVIOR] INV-2 [vitest exit语义] oracle 实跑确认 exit（子 shell --root . 走默认 include，非 include 外空跑）—— 由 B-01..B-05 与 E2E 脚本的 `[1-9][0-9]* passed` 宽松断言承载（已实测 RED→exit1 / GREEN→exit0）
  Test: manual:bash -c 'grep -q "cd sprints/08231107-kernel-ccd99d19 && npx vitest run --root ." sprints/08231107-kernel-ccd99d19/contract-dod.md && echo OK'
- [ ] [BEHAVIOR] INV-3 [status枚举全查] 新增 materializing 全仓库检查无遗漏硬编码 —— 见 ARTIFACT「status 枚举新增值全仓库无遗漏」条（等价断言，避免重复）
  Test: manual:bash -c 'echo "N/A: 由 ARTIFACT status 枚举全查条承载"'
- N/A [Red commit精确]：进程约束（Red commit 只 `git add` 精确 `tests/*.test.js`，禁 `git add .`）——由 proposer/generator 提交纪律执行，非运行时可断言产物；本轮 proposer 已按精确路径 add（见 notes）。
- N/A [manual oracle真跑]：本合同批准前已实测每条 oracle 真实 exit（RED `1 failed`/GREEN `5 passed`，见 Test Contract 备注），目标解释器（node/vitest）确实启动。
- N/A [local_api judge闸]：本任务 local_api 无 UI smoke，全部 oracle 为 vitest 真跑（真 exit + `N passed` stdout），非 meta 自证，规避机械闸⑤ meta_verification_gap。
- N/A [系统]真环境验证：真 PG 原子/崩溃残行验证落 brain-integration（见「未覆盖真实链路清单」）；本 attempt postgres:false 无法本地真库跑。
- N/A [系统]多租户/租户隔离：投影按 scope_key 分区，本 sprint 不改 scope 边界，无跨租户读写；纯内核时序修复。
- N/A [系统]禁止写死环境假设值：无屏幕坐标/端口/env 假设值；status 值来自 schema CHECK 枚举（migration 权威）。
- N/A [系统]单 slot 串行：换代换代由 scheduler 周期任务串行触发，唯一部分索引 `WHERE status='active'` 保证并发换代下每 scope 仍至多一个 active。
