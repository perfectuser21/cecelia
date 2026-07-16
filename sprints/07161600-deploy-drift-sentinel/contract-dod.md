# Contract DoD — G2：部署漂移哨兵（Deploy Drift Sentinel）

- task_id: dfa89a0b-3cb9-4bdc-8d41-7b4ed80d997d
- 日期: 2026-07-16
- 合同轮次: 2（Round 2，reviewer feedback 修订版）

---

## [BEHAVIOR] B1：SHA 一致时不触发部署（INV-09）

**触发条件**：origin/main HEAD SHA 等于生产 /health git_sha

**预期行为**：
- `verdict=ok`
- deploy 函数调用次数 = 0
- driftFirstSeenAt 清除（若之前有设置）
- 日志打印 `[drift_check] sha_main=<X> sha_prod=<X> verdict=ok`
- 判定依据为 SHA 对账，不引入路径判据（INV-09：不得重新引入路径判据）

**测试文件**：`sprints/07161600-deploy-drift-sentinel/tests/drift-sentinel.test.js`（FR-15-ok 用例）

**manual:bash**：
```bash
# 验证 drift-sentinel job 存在且 verdict=ok 逻辑可达
grep -n "verdict.*ok\|verdict = 'ok'" packages/brain/src/cron/drift-sentinel.js

# 验证日志格式
docker logs cecelia-brain 2>&1 | grep "\[drift_check\]" | grep "verdict=ok" | tail -3

# INV-01 验证：禁止引入路径判据（断言为 0）
grep -rn "changed_paths\|file.*filter\|path.*filter" packages/brain/src/cron/drift-sentinel.js | wc -l
# 预期输出: 0
```

---

## [BEHAVIOR] B2：SHA 不等但未满 30min 时进入防抖等待（INV-10）

**触发条件**：origin/main HEAD SHA != 生产 SHA，且 driftFirstSeenAt 记录时间距现在 < 30min（模拟：29min59s）

**预期行为**：
- `verdict=drifting`
- deploy 函数调用次数 = 0
- driftFirstSeenAt 保留（不清除）
- 日志打印 `[drift_check] sha_main=<X> sha_prod=<Y> verdict=drifting`
- 防抖首见记时间戳以防止误触发（INV-10：补部署触发前须用 SHA 二次核验，防抖首见记时间戳）

**测试文件**：`sprints/07161600-deploy-drift-sentinel/tests/drift-sentinel.test.js`（FR-15-debounce 用例）

**manual:bash**：
```bash
# 验证防抖逻辑存在
grep -n "driftFirstSeenAt\|30.*min\|DRIFT.*WINDOW\|1800000" packages/brain/src/cron/drift-sentinel.js

# 验证 30min 阈值常量
node -e "
const src = require('fs').readFileSync('packages/brain/src/cron/drift-sentinel.js', 'utf8');
const match = src.match(/DRIFT.*WINDOW.*=.*(\d+)/);
console.log('drift window ms:', match ? match[1] : 'NOT FOUND');
const expected = 30 * 60 * 1000;
console.log('expected 30min ms:', expected);
"
```

---

## [BEHAVIOR] B3：SHA 不等且持续超 30min 时触发自动补部署（INV-10）

**触发条件**：origin/main HEAD SHA != 生产 SHA，且 driftFirstSeenAt 记录时间距现在 >= 30min（模拟：30min01s）

**预期行为**：
- `verdict=redeploying`
- deploy 函数调用次数 = 1（exec `bash scripts/brain-deploy.sh`）
- `redeployCount` 递增
- 日志打印 `[drift_check] sha_main=<X> sha_prod=<Y> verdict=redeploying`
- **禁止** mock isDrifted() 与 runDeploy() 之间的边（INV-04）
- **补部署触发前必须执行 SHA 二次核验**（INV-10：fetchProdSha 调用次数 ≥2，防止防抖窗口内状态翻转导致误部署）

**测试文件**：`sprints/07161600-deploy-drift-sentinel/tests/drift-sentinel.test.js`（FR-15-redeploy 用例）

**manual:bash**：
```bash
# 验证 brain-deploy.sh 调用路径
grep -n "brain-deploy.sh\|runDeploy\|execDeploy" packages/brain/src/cron/drift-sentinel.js

# L2 实弹验证（手动）：关 webhook → push commit → 等 30min → 查日志
docker logs cecelia-brain 2>&1 | grep "\[drift_check\].*verdict=redeploying" | tail -5

# 验证 deploy record 入库
psql cecelia -c "SELECT id, sha, created_at FROM deploy_records ORDER BY created_at DESC LIMIT 1;"
```

---

## [BEHAVIOR] B4：连续 2 次补部署后仍漂移时上报告警，停止重试

**触发条件**：redeployCount >= 2，且当前检查 SHA 仍不一致

**预期行为**：
- `verdict=escalated`
- deploy 函数调用次数 = 0（不再重试）
- `sendBark` 被调用一次（dedupeKey=drift-escalated，TTL=6h）
- Notion issue 被创建（priority=P1，sub-area=brain）
- 日志打印 `[drift_check] sha_main=<X> sha_prod=<Y> verdict=escalated`

**测试文件**：`sprints/07161600-deploy-drift-sentinel/tests/drift-sentinel.test.js`（FR-15-escalate 用例）

**manual:bash**：
```bash
# 验证告警调用
grep -n "sendBark\|raise\|escalated\|redeployCount" packages/brain/src/cron/drift-sentinel.js

# 验证 dedupeKey
grep -n "drift-escalated" packages/brain/src/cron/drift-sentinel.js

# 验证 Bark 告警被调用（如有告警日志）
docker logs cecelia-brain 2>&1 | grep "drift-escalated\|escalated" | tail -5
```

---

## [BEHAVIOR] B5：网络失败时保守 skip，不触发部署

**触发条件**：`gh api` 和 `git ls-remote` 均失败（exit non-0 或超时）

**预期行为**：
- `verdict=network_error`
- deploy 函数调用次数 = 0
- 日志打印 `[drift_check] ... verdict=network_error`

**测试文件**：`sprints/07161600-deploy-drift-sentinel/tests/drift-sentinel.test.js`（FR-15-network-error 用例）

**manual:bash**：
```bash
# 验证网络失败处理
grep -n "network_error\|catch.*skip\|network.*fail" packages/brain/src/cron/drift-sentinel.js

# 模拟网络失败（断开后查日志）
docker logs cecelia-brain 2>&1 | grep "verdict=network_error" | tail -3
```

---

## [BEHAVIOR] B6：生产 /health 不可达时保守 skip，不触发部署

**触发条件**：`BRAIN_PROD_URL/health` 请求失败（网络错误或非 200）

**预期行为**：
- `verdict=prod_unreachable`
- deploy 函数调用次数 = 0
- 日志打印 `[drift_check] ... verdict=prod_unreachable`

**测试文件**：`sprints/07161600-deploy-drift-sentinel/tests/drift-sentinel.test.js`（FR-15-prod-unreachable 用例）

**manual:bash**：
```bash
# 验证生产不可达处理
grep -n "prod_unreachable\|BRAIN_PROD_URL\|health.*fail" packages/brain/src/cron/drift-sentinel.js
```

---

## [BEHAVIOR] B7：drift-sentinel job 在 tick-runner.js 中注册（INV-05）

**预期行为**：
- `packages/brain/src/tick-runner.js` 中有 `import ... from './cron/drift-sentinel.js'`
- 调度逻辑中有 `DRIFT_SENTINEL_INTERVAL_MS` 对比触发
- 不另起进程，复用 tick 调度（同 launchd-patrol 模式）

**manual:bash**：
```bash
# 验证注册
grep -n "drift-sentinel\|driftSentinel\|runDriftSentinel" packages/brain/src/tick-runner.js

# 验证 interval 可由 env 覆盖
grep -n "DRIFT_SENTINEL_INTERVAL_MS\|process.env.*DRIFT" packages/brain/src/cron/drift-sentinel.js
```

---

## [BEHAVIOR] B8：连续 3 次网络 skip → P2 告警（INV-09）

**触发条件**：`consecutiveNetworkErrors` 计数达到 3（连续 3 轮检查均返回 `verdict=network_error`）

**预期行为**：
- `verdict=network_error`（本轮仍 skip，不触发部署）
- `sendBark` 被调用一次（dedupeKey 含 `network-skip`，告警等级 P2）
- 日志打印 `[drift_check] ... verdict=network_error consecutive_network_errors=3`
- **禁止**因网络连接失败触发任何部署动作（INV-09：S0 不得引入路径判据，保守 skip 优先）

**测试文件**：`sprints/07161600-deploy-drift-sentinel/tests/drift-sentinel.test.js`（FR-15-network-skip-x3 用例）

**manual:bash**：
```bash
# 验证连续网络失败计数逻辑存在
grep -n "consecutiveNetworkErrors\|consecutive.*network\|network.*count" packages/brain/src/cron/drift-sentinel.js

# 验证 P2 告警调用
grep -n "network-skip\|P2\|network.*bark" packages/brain/src/cron/drift-sentinel.js

# 模拟验证（断开网络后连续 3 轮观测）
docker logs cecelia-brain 2>&1 | grep "verdict=network_error" | tail -5
```

---

## 完整 DoD 检查清单

### 实现检查

- [ ] `packages/brain/src/cron/drift-sentinel.js` 文件存在
- [ ] `packages/brain/src/tick-runner.js` 中有 import + 每 30min 触发调用
- [ ] FR-09/FR-10 网络失败路径有单测覆盖
- [ ] FR-11 防抖 30min 逻辑有 passing 单测（含边界：29min59s 不触发，30min01s 触发）
- [ ] FR-13 连续 2 次后上报 sendBark + notion issue，不继续 deploy
- [ ] FR-14 审计日志格式 `[drift_check] sha_main=... sha_prod=... verdict=...`
- [ ] DRIFT_SENTINEL_INTERVAL_MS 可由 env 变量覆盖

### 测试检查

- [ ] FR-15 failing test 在 merge 前 CI red（drift-sentinel.js 不存在时）
- [ ] FR-15 实现后所有 8 个 [BEHAVIOR] 场景 CI green（含 B8 network-skip-x3）
- [ ] `brain-ci.yml` 测试矩阵包含 `drift-sentinel.test.js`（或 sprints/tests/）
- [ ] 测试未 mock isDrifted() 与 runDeploy() 之间的边（INV-04）
- [ ] FR-15-redeploy 用例断言 fetchProdSha 调用次数 ≥2（INV-10 二次核验）
- [ ] FR-15-network-skip-x3 用例通过：第 3 次连续 network_error 时 sendBark 被调（B8）

### 系统约束检查

- [ ] 不引入路径判据（INV-01）：`grep -rn "changed_paths\|file.*filter\|path.*filter" packages/brain/src/cron/drift-sentinel.js | wc -l` 输出为 0
- [ ] 补部署走 brain-deploy.sh 全闸（INV-02）
- [ ] 蓝绿/pre-swap/post-deploy 现有机制一律不动（INV-03）：drift-sentinel.js 不得修改 bluegreen 相关文件
- [ ] 告警走 sendBark + raise（INV-06）
- [ ] PASS@L2 声明（INV-07）：FR-16 live-fire-report.md 完成后标记
- [ ] S0 为 S1 感知层的深度防御兜底，不替代 S1（INV-08）：drift-sentinel.js 不禁用 webhook/S1 通路，仅作兜底
- [ ] S0 不引入路径判据（INV-09）：告警与 skip 判定仅依赖 SHA 对账结果，不含路径过滤
- [ ] 补部署触发前 SHA 二次核验（INV-10）：redeploying 分支执行前再次调用 fetchProdSha 确认漂移持续

### 手动 smoke 验证

```bash
# 全量检查一键跑
grep -rn "drift-sentinel\|runDriftSentinel" /workspace/packages/brain/src/tick-runner.js && \
grep -rn "verdict.*ok\|verdict.*drifting\|verdict.*redeploying\|verdict.*escalated" /workspace/packages/brain/src/cron/drift-sentinel.js && \
grep -rn "drift.sentinel" /workspace/packages/brain/src/package.json 2>/dev/null || true && \
echo "manual:bash smoke PASS"
```

---

## CI 永驻要求

FR-15 测试必须在 `brain-ci.yml` L1 矩阵中显式列出，不可删除。

示例配置（供实现参考）：
```yaml
# .github/workflows/brain-ci.yml
- name: drift-sentinel unit tests
  run: |
    cd packages/brain
    npx vitest run src/cron/__tests__/drift-sentinel.test.js
    # 或 sprint 目录
    npx vitest run ../../sprints/07161600-deploy-drift-sentinel/tests/drift-sentinel.test.js
```
