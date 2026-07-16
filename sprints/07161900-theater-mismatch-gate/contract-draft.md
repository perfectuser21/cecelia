# Contract Draft — 建制W6: 戏院错配机械闸 + 元验证补丁

- task_id: b317ae29-9fbc-4d6f-abf0-016141d6c657
- sprint_dir: sprints/07161900-theater-mismatch-gate
- 日期: 2026-07-16
- journey_type: bug_fix
- target_environment: local_api

---

## 背景

给 `packages/brain/src/harness-judge.js` 的 `runMechanicalGate` 函数新增两条纯代码机械预检：

1. **戏院错配闸**（`theater_mismatch`）：GP/contract BEHAVIOR 含真机关键词但 `target_environment=local_api/mac_web` → `mechFail`
2. **元验证补丁**（`meta_verification_gap`）：smoke/验证脚本类交付，contract Final E2E 没有真目标复核断言 → `mechFail`

两闸纯结构校验，不调 AI，执行耗时 < 5ms。

---

## Golden Path

generator 从 [sprint-prd 含 GP「微信真机发送消息」+ tasks.payload.target_environment=local_api] →
经过 [harness-judge 戏院错配闸，检测 GP 文本含真机关键词但环境标 local] →
到达 [mechFail=theater_mismatch，pipeline 阻断，feedback 指明应路由 windows_wechat]

---

## Test Contract 表

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| W6-theater-mismatch | `tests/theater-mismatch-contract.test.js` | theater_mismatch/meta_verification_gap/正常 local_api | Red: 5 FAIL before impl（TC-01/03/04/05 fail, TC-06 fail on missing function）|

---

## E2E 验收

### Final E2E（自动化）

以下 `runMechanicalGate` 行为断言通过 vitest 单元测试验证：

1. **TC-01 戏院错配 FAIL**：调用 `runMechanicalGate`，sprint-prd GP 段含「微信真机发送消息」，DB 返回 `target_environment=local_api`，断言 `result.pass === false` 且 `result.reasons.join('').includes('theater_mismatch')`。

2. **TC-04 元验证缺失 FAIL**：调用 `runMechanicalGate`，sprint-prd 标题含 `smoke`，contract BEHAVIOR 仅普通 curl，断言 `result.pass === false` 且 `result.reasons.join('').includes('meta_verification_gap')`。

3. **TC-06 正常合同不误伤**：调用 `runMechanicalGate`，sprint-prd 无真机关键词，断言 `result.pass === true`。

4. **TC-07 env 关键词扩展**：设置 `THEATER_KEYWORDS_EXTRA=海外渠道`，GP 含「海外渠道投放」，断言 `result.pass === false` 且 reasons 含 `theater_mismatch`。

### 验收命令（手动回归）

```bash
# 运行完整 theater 测试套件
cd /workspace && node --experimental-vm-modules node_modules/.bin/vitest run packages/brain/src/__tests__/harness-judge-theater.test.js --reporter=verbose 2>&1

# 快速冒烟：戏院错配闸
node -e "import('./packages/brain/src/harness-judge.js').then(m => m.runMechanicalGate({taskId:'t1',worktreePath:'/tmp',sprintDir:'x',brainResult:{verdict:'PASS',behavior_tests:[{command:'c',exit_code:0,log_tail:'ok'}]}},{readFileFn:async(p)=>{if(p.includes('sprint-prd'))return '## Golden Path\n1. 微信真机发送消息\n';if(p.includes('contract'))return '[BEHAVIOR] cmd\nTest: adb shell send';throw new Error('ENOENT');},listTestFilesFn:async()=>['a.test.ts'],dbPool:{query:async()=>({rows:[{target_environment:'local_api'}]})}}).then(r=>{if(!r.pass&&r.reasons.join().includes('theater_mismatch'))console.log('PASS');else{console.error('FAIL',r);process.exit(1);}}))"

# 快速冒烟：元验证补丁
node -e "import('./packages/brain/src/harness-judge.js').then(m => m.runMechanicalGate({taskId:'t2',worktreePath:'/tmp',sprintDir:'y',brainResult:{verdict:'PASS',behavior_tests:[{command:'c',exit_code:0,log_tail:'ok'}]}},{readFileFn:async(p)=>{if(p.includes('sprint-prd'))return '# Sprint PRD — smoke 验证脚本演习\n## Golden Path\n1. 验证脚本执行\n';if(p.includes('contract'))return '[BEHAVIOR] curl localhost/api\nTest: manual:curl localhost/api';throw new Error('ENOENT');},listTestFilesFn:async()=>['a.test.ts'],dbPool:{query:async()=>({rows:[{target_environment:'local_api'}]})}}).then(r=>{if(!r.pass&&r.reasons.join().includes('meta_verification_gap'))console.log('PASS');else{console.error('FAIL',r);process.exit(1);}}))"
```

---

## 未覆盖真实链路清单

以下链路因条件限制不在本 sprint 自动覆盖范围内：

1. **`THEATER_KEYWORDS_EXTRA` 运行时 env 注入**：env 变量在进程启动时解析，测试需 fork 子进程或通过 harness 桩注入，本 sprint 测试通过进程级 `process.env` 设置覆盖，但生产流水线的 env 传递路径未做端到端验证。
2. **`target_environment` DB 查询失败降级行为**：DB 查询异常时保守降级为 `local_api`，本 sprint 测试用 mock dbPool，未覆盖真实 PostgreSQL 连接超时场景。
3. **sprint-prd.md 文件读取失败时的闸行为**：若 `readFileFn` 对 sprint-prd.md 抛出 ENOENT，当前实现保守跳过（不误杀），该路径在集成层未测试。
4. **contract-draft.md 含 THEATER 关键词但 sprint-prd 不含时的行为**：FR-02 同时扫描 GP 段和 BEHAVIOR 命令文本，交叉场景未单独测试。
