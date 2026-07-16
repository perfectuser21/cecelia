# Sprint PRD — 建制W6: 戏院错配机械闸 + 元验证补丁

- task_id: b317ae29-9fbc-4d6f-abf0-016141d6c657
- sprint_dir: sprints/07161900-theater-mismatch-gate
- 挂靠决策: 145014a4（无闸不成文口径）、dc18d43d（pipeline判据下沉代码）
- 日期: 2026-07-16

---

## 背景

根因（07-16 Alex 痛点）：evaluator 很重（模拟真人）但花在错误剧场——gp4 系列合同把 RPA 路径标
`local_api`，v9.0.0 的 `target_environment` 推断规则是条文无闸，任务框成「写脚本」即合法绕过。
两个洞一次焊死：

1. **戏院错配闸**：GP 内容碰真机/RPA 关键词但任务标 `local_api`/`mac_web` → 直接 `mechFail`。
2. **元验证补丁**：smoke/验证脚本类交付物，合同 Final E2E 必须含至少一条真目标复核断言
   （「考生不得自己出考卷收卷」）。

---

## Invariant 约束

| ID | 来源 | 约束 |
|----|------|------|
| INV-01 | dc18d43d | pipeline 生命周期/验收判据必须下沉代码闸；条文无代码闸对应计 0 |
| INV-02 | 9216d107 | harness-judge 在校验前必须先读 target_environment，按环境能力上限校准证据要求 |
| INV-03 | 6d11717d | target_environment=local_api 弱环境下，禁止把 CI 绿直接当不可验项放行 |
| INV-04 | 09fb5c69 | 合同必须 1:1 映射 PrepPRD Golden Path；GAN reviewer 审合同须逐步核对 BEHAVIOR 覆盖 |
| INV-05 | 06950012 | 真机（安卓/Windows）相关 runner/E2E 一律归 ZenithJoy；Cecelia 主仓只跑 local/cloud |
| INV-06 | 3efefc23 | feat+brain/src PR 开 PR 前必须带齐 smoke.sh + smoke-allowlist 登记 |
| INV-07 | 5e125909 | 环境假设值禁止写死；接缝断言必须从环境推导或真机校准 |
| INV-08 | 3c30394c | 依赖真机/真实调用方的接缝断言必须在真目标验证过才算 done |

---

## 累积 FR

**前置已有（不重新实现）：**
- FR-BASE-01: `runMechanicalPreflightChecks` — behavior_tests/exit_code/log_tail 结构校验（W2 #4004）
- FR-BASE-02: `runMechanicalGate` — behavior_tests E1 机械化 + sprint 测试文件存在性 + judgments_written 对账
- FR-BASE-03: L3 真机指纹执法（verification_level 分级：L3 要求 log_tail 含设备路径/UIA/adb 关键词）
- FR-BASE-04: `target_environment` 从 DB tasks.payload 读取，查不到降级 local_api（W4 #4004）
- FR-BASE-05: `DEVICE_LOG_ENVS = Set(['windows_wechat'])` — 真机环境 log_tail 强制非空校验

**本 sprint 新增：**
- **FR-01**：新增 `THEATER_REAL_MACHINE_KEYWORDS` 常量数组（可 env 扩展），默认包含：
  `微信`、`UIA`、`xian-rog`、`windows_wechat`、`真机`、`RPA`、`adb`、`android`
- **FR-02**：`runMechanicalGate` 内新增「戏院错配闸」：
  - 读 sprint-prd.md Golden Path 段 + contract-draft.md `[BEHAVIOR]` 命令文本
  - 若任意文本含 THEATER 关键词，且 `target_environment ∈ {local_api, mac_web}` → 返回 `mechFail=theater_mismatch`
  - feedback 须指明应路由的真机环境（windows_wechat / android_realmachine）
- **FR-03**：`runMechanicalGate` 内新增「元验证补丁」：
  - 若 sprint-prd 标题 或 Golden Path 出口行含关键词 `smoke`/`验证脚本`/`演习`
  - 则 contract `[BEHAVIOR]` 条目中必须至少有一条含 THEATER 关键词或显式 `verification_level: L3`
  - 缺失 → `mechFail=meta_verification_gap`，feedback 说明「考生不得自己出考卷收卷」原则
- **FR-04**：两闸均为纯结构校验，不调 AI；关键词解析路径禁止被测试 mock 掉
- **FR-05**：先写 failing test（三场景）：
  1. GP 含「微信真机发送」+ `target_environment=local_api` → 当前版本放行（failing），修复后 `theater_mismatch`
  2. smoke 类标题 + contract 无 L3/THEATER 断言 → `meta_verification_gap`
  3. 正常 local_api 服务端合同（无真机关键词）→ 不误伤（回归）
- **FR-06**：`THEATER_REAL_MACHINE_KEYWORDS` 支持通过 env `THEATER_KEYWORDS_EXTRA` 以逗号分隔追加（可扩展性）
- **FR-07**：brain smoke-allowlist 登记新增的导出函数（如新增独立函数）
- **FR-08**：engine 版本无需 bump（仅改 brain/src/harness-judge.js，非 engine 包）

---

## NFR

- 两闸均为同步纯结构校验，不调网络/AI，执行耗时 < 5ms
- 关键词匹配大小写不敏感（避免 `RPA` vs `rpa` 漏判）
- `target_environment` 读取复用已有 DB 查询路径，查不到 → 保守缺省 `local_api`（不误杀无环境标注的旧任务）
- 测试文件写入 `packages/brain/src/__tests__/harness-judge-theater.test.js`，进 brain-ci.yml 回归

---

## Golden Path（核心场景）

generator 从 [sprint-prd 含 GP「微信真机发送消息」+ tasks.payload.target_environment=local_api] →
经过 [harness-judge 戏院错配闸，检测 GP 文本含真机关键词但环境标 local] →
到达 [mechFail=theater_mismatch，pipeline 阻断，feedback 指明应路由 windows_wechat]

---

## 验收标准（[BEHAVIOR]）

- [BEHAVIOR] `theater_mismatch` 闸对 GP 含「微信真机发送」+ local_api 判 FAIL
  Test: manual:node -e "import('./packages/brain/src/harness-judge.js').then(m => m.runMechanicalGate({taskId:'t1',worktreePath:'/tmp',sprintDir:'x',brainResult:{verdict:'PASS',behavior_tests:[{command:'c',exit_code:0,log_tail:'ok'}]}},{readFileFn:async(p)=>{if(p.includes('sprint-prd'))return '## Golden Path\n1. 微信真机发送消息\n';if(p.includes('contract'))return '[BEHAVIOR] cmd\nTest: adb shell send';throw new Error('ENOENT');},listTestFilesFn:async()=>['a.test.ts'],dbPool:{query:async()=>({rows:[{target_environment:'local_api'}]})}}).then(r=>{if(!r.pass&&r.reasons.join().includes('theater_mismatch'))console.log('PASS');else{console.error('FAIL',r);process.exit(1);}}))"

- [BEHAVIOR] `meta_verification_gap` 闸对 smoke 类交付物无 L3 断言判 FAIL
  Test: manual:node -e "import('./packages/brain/src/harness-judge.js').then(m => m.runMechanicalGate({taskId:'t2',worktreePath:'/tmp',sprintDir:'y',brainResult:{verdict:'PASS',behavior_tests:[{command:'c',exit_code:0,log_tail:'ok'}]}},{readFileFn:async(p)=>{if(p.includes('sprint-prd'))return '# Sprint PRD — smoke 验证脚本演习\n## Golden Path\n1. 验证脚本执行\n';if(p.includes('contract'))return '[BEHAVIOR] curl localhost/api\nTest: manual:curl localhost/api';throw new Error('ENOENT');},listTestFilesFn:async()=>['a.test.ts'],dbPool:{query:async()=>({rows:[{target_environment:'local_api'}]})}}).then(r=>{if(!r.pass&&r.reasons.join().includes('meta_verification_gap'))console.log('PASS');else{console.error('FAIL',r);process.exit(1);}}))"

- [BEHAVIOR] 正常 local_api 服务端合同不被误伤
  Test: manual:node -e "import('./packages/brain/src/harness-judge.js').then(m => m.runMechanicalGate({taskId:'t3',worktreePath:'/tmp',sprintDir:'z',brainResult:{verdict:'PASS',behavior_tests:[{command:'npm test',exit_code:0,log_tail:'ok'}]}},{readFileFn:async(p)=>{if(p.includes('sprint-prd'))return '## Golden Path\n1. 调用 API 返回 200\n';if(p.includes('contract'))return '[BEHAVIOR] curl localhost/api\nTest: manual:curl localhost/api';throw new Error('ENOENT');},listTestFilesFn:async()=>['a.test.ts'],dbPool:{query:async()=>({rows:[{target_environment:'local_api'}]})}}).then(r=>{if(r.pass)console.log('PASS');else{console.error('FAIL',JSON.stringify(r));process.exit(1);}}))"

---

## 文件范围

- 修改：`packages/brain/src/harness-judge.js`（新增两闸，扩展 `runMechanicalGate`）
- 新增：`packages/brain/src/__tests__/harness-judge-theater.test.js`（failing test 先提交）
- 可能更新：`packages/quality/smoke-allowlist.txt`（如新增导出函数需登记）

---

journey_type: bug_fix
target_environment: local_api
