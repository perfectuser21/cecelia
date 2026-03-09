---
id: quality-spec
version: 1.0.0
created: 2026-03-09
updated: 2026-03-09
owner: CTO
changelog:
  - 1.0.0: 初始版本 — 定义完整质量系统终态
---

# 质量系统规格（QUALITY_SPEC）

> **这是质量系统的唯一真实源（SSOT）。**
> 所有 CI check、Hook、DoD 规范、测试要求，以本文件为准。
> 改质量系统任何部分之前，必须先更新本文件并走 /dev 流程。

---

## 一、问题陈述

质量系统被修改数百次，每次修 A 坏 B，根本原因：

1. **无规格** — 没人知道"完整"长什么样，每次修一个点，不看全局
2. **点对点修复** — 修完一个漏洞，另一个漏洞暴露
3. **质量系统本身无测试** — 改了 CI 没有机制验证它还能工作
4. **DoD 和测试不联动** — 两层各说各的，互不验证

本文定义终态。所有实现必须对照本文验收。

---

## 二、质量系统全景图

```
用户意图
  │
  ▼
PRD（要做什么 + 成功标准）
  │   [Layer 1: PRD 必须有"成功标准"章节，≥2 条]
  ▼
DoD（如何证明做到了，每条有 Test 字段）
  │   [Layer 2: 每条 DoD 必须追溯到 PRD 某条成功标准]
  ▼
代码实现（新功能 + 删除被替换的旧代码）
  │   [Layer 3: DoD 有清理条目 → diff 必须有删除行]
  ▼
测试（单元测试覆盖 DoD 场景）
  │   [Layer 4: Test 文件覆盖 DoD 描述的 API/函数]
  ▼
CI（独立验证，不信任 AI 自评）
  │   [Layer 5: 100% 通过，enforce_admins 无例外]
  ▼
Learning（根本原因 + 下次预防措施）
  │   [Layer 6: 格式化，驱动下次 DoD checklist]
  ▼
下次任务（Learning 约束进入新任务 DoD）
```

---

## 三、Dev 步骤 × CI 覆盖矩阵

| Dev 步骤 | 应有 CI | 当前状态 | Phase |
|---------|--------|---------|-------|
| Step 0 Worktree | 本地 Hook 足够 | ✅ 已实现 | — |
| Step 1 PRD | check-prd：必须有"成功标准"章节 ≥2 条 | ❌ 只查文件存在 | Phase 2 |
| Step 2 Detect | 无需 CI | — | — |
| Step 3 Branch | DevGate：cp-XXXXXXXX 格式 | ✅ 已实现 | — |
| Step 4 Explore | 无需 CI | — | — |
| Step 5 DoD | check-dod-mapping：Test 字段 + [x] 验证 | ✅ 已实现 | DoD↔PRD 追溯 Phase 2 |
| Step 6 Code | Brain Tests：vitest 单元测试 | ✅ 已实现 | 覆盖率门槛 Phase 2 |
| Step 6.5 Simplify | cleanup-check：清理 DoD → diff 有删除行 | ✅ 已实现（#732） | — |
| Step 7 Verify | local_test_status：失败阻止 push | ✅ 已实现（#608） | — |
| Step 8 PR | CI 自动触发 | ✅ 已实现 | — |
| Step 9 CI Monitor | Stop Hook + enforce_admins | ✅ 已实现 | — |
| Step 10 Learning | check-learning：根本原因+预防字段 | ❌ 只查标记 | Phase 3 |
| Step 11 Cleanup | 本地 Hook 足够 | ✅ 已实现 | — |

---

## 四、各 CI Check 规格

### 4.1 DevGate（所有 PR 必须通过）

#### check-branch-name
```
规则：分支名匹配 cp-XXXXXXXX-task-name
强度：HARD GATE（exit 1）
状态：✅ 已实现
```

#### check-prd【Phase 2】
```
规则：
  - .prd-<branch>.md 必须存在
  - 必须包含"成功标准"章节
  - 成功标准至少 2 条
强度：HARD GATE（exit 1）
状态：❌ 只查文件存在
```

#### check-dod-mapping
```
规则（当前）：
  - 每条有 Test 字段，非 TODO/占位符
  - 所有 [ ] 已变 [x]
  - tests/ 引用文件真实存在
规则（Phase 2 新增）：
  - DoD 每条能追溯到 PRD 成功标准关键词
  - manual:curl 必须有断言（| jq 或 | grep）
强度：HARD GATE（exit 1）
状态：✅ 已实现（Phase 2 追溯待加）
```

#### cleanup-check
```
规则：DoD 有重构/清理关键词 + PR diff 删除行 == 0 → exit 1
强度：HARD GATE（exit 1）
状态：✅ 已实现（PR #732）
```

### 4.2 Brain Tests

#### unit-tests
```
规则：npm run qa 通过（vitest）
覆盖率门槛【Phase 2】：改动文件覆盖率 ≥ 80%
强度：HARD GATE（exit 1）
状态：✅ 已实现（覆盖率门槛 Phase 2）
```

#### integration-tests【Phase 2】
```
规则：API 端点改动必须有 E2E 测试，RCI P0/P1 全通过
强度：HARD GATE（exit 1）
状态：⚠️ 有框架，覆盖不完整
```

### 4.3 enforce_admins
```
规则：管理员无法绕过 CI 强制合并
状态：✅ 已实现（cecelia、infrastructure）
维护：任何仓库新建时必须开启
```

### 4.4 local_test_status 门禁
```
规则：Step 7 本地测试失败 → Stop Hook exit 2 阻止 push
状态：✅ 已实现（PR #608）
```

### 4.5 check-learning【Phase 3】
```
规则：
  - LEARNINGS.md 新增条目必须有"根本原因"章节
  - 必须有"下次预防"章节，至少 1 条 checklist
  - 禁止模糊描述（"注意 XXX"等）
强度：HARD GATE（exit 1）
状态：❌ 不存在
```

### 4.6 质量系统元测试【Phase 3】
```
位置：tests/quality-system/
规则：改质量系统任何文件 → 元测试必须全过
元测试清单：
  test-cleanup-check.sh    → 模拟有清理DoD无删除行 → 验证 exit 1
  test-branch-name.sh      → 模拟错误分支名 → 验证 CI 拦截
  test-dod-mapping.sh      → 模拟缺 Test 字段 → 验证 CI 拦截
  test-enforce-admins.sh   → 验证管理员无法绕过
  test-prd-check.sh        → 模拟无成功标准 PRD → 验证拦截
状态：❌ 不存在
```

---

## 五、实现路线图

### Phase 1：锁底座（2026-03-09，已完成）

**目标：PR 合并前 CI 100% 无法绕过**

| 项目 | 状态 | PR |
|------|------|-----|
| enforce_admins: true | ✅ | API |
| brain-ci.yml hard gate | ✅ | #730 |
| infrastructure CI 三假检查修复 | ✅ | #13 |
| cleanup-check exit 1 | ✅ | #732 |
| local_test_status 门禁 | ✅ | #608 |

**验收标准：**
- [x] 管理员无法强制合并失败 PR
- [x] DoD 有清理条目但无删除行 → CI exit 1
- [x] 本地 npm test 失败 → Stop Hook 阻止 push

---

### Phase 2：锁链条（2026-03-16）

**目标：PRD → DoD → Test 形成合约，不能各说各的**

| 项目 | 实现方式 | 优先级 |
|------|---------|--------|
| PRD 成功标准章节检查 | check-prd.sh + devgate | P0 |
| DoD ↔ PRD 关键词追溯 | check-dod-coverage.cjs | P0 |
| Test 文件覆盖 DoD 场景 | check-test-coverage.cjs | P1 |
| 单元测试覆盖率 ≥ 80% | vitest coverage threshold | P1 |
| 集成测试回归契约补全 | regression-contract.yaml | P2 |

**验收标准：**
- [ ] DoD 不追溯 PRD 成功标准 → CI exit 1
- [ ] 单元测试覆盖率 < 80% → CI exit 1
- [ ] Test 不覆盖 DoD 场景 → CI warning（Phase 3 升 exit 1）

---

### Phase 3：锁学习和元测试（2026-03-23）

**目标：质量系统本身有测试，Learning 有约束力**

| 项目 | 实现方式 | 优先级 |
|------|---------|--------|
| Learning 格式检查 | check-learning.sh + CI | P0 |
| Learning → 下次 DoD checklist | 自动提取"下次预防"条目 | P1 |
| 质量系统元测试 | tests/quality-system/*.sh | P0 |
| 改质量系统文件触发元测试 | brain-ci.yml 新增 job | P0 |

**验收标准：**
- [ ] Learning 无根本原因章节 → CI exit 1
- [ ] 改 devgate.yml → 元测试自动跑
- [ ] 改 stop-dev.sh → 元测试自动跑

---

## 六、质量分诚实评分

| 维度 | Phase 1 后 | Phase 2 后 | Phase 3 后 |
|------|-----------|-----------|-----------|
| CI 强制力 | **90%** | 90% | 95% |
| PRD→DoD→Test 链条 | 20% | **75%** | 85% |
| 测试真实覆盖需求 | 30% | **70%** | 80% |
| 学习回路有效性 | 10% | 10% | **70%** |
| 质量系统自身安全 | 0% | 0% | **80%** |
| **综合** | **45%** | **65%** | **82%** |

**目标：Phase 3 完成后综合 ≥ 80%，转维护模式，停止修质量系统本身。**

---

## 七、永久禁止行为

```
❌ exit 1 降级为 echo warning（视为质量系统回退，必须回滚）
❌ DoD 写"功能正常工作"等无法客观验证的条目
❌ CI check 只检查文件存在不检查内容
❌ Learning 只写"注意 XXX"等模糊一行
❌ 质量系统任何改动不走 /dev
❌ enforce_admins 被关闭（任何仓库）
❌ 管理员绕过 CI 强制合并
```

---

## 八、本文件维护规则

1. 本文是 SSOT，质量系统任何改动必须同步更新本文
2. 更新本文必须走 /dev，不允许直接改 main
3. 每 Phase 完成后更新矩阵状态（✅/🔄/❌）
4. 版本号：新增规则 minor bump，修改现有规则 patch bump

---

*最后更新：2026-03-09 | 负责人：CTO*
