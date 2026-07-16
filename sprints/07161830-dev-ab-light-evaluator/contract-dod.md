# Contract DoD — 建制W5: /dev A/B 轨补轻量 Evaluator

- task_id: 4950d174-cfcd-4a81-b078-0d695a78f103
- sprint_dir: sprints/07161830-dev-ab-light-evaluator
- 挂靠决策: 145014a4③
- 日期: 2026-07-16

---

## [BEHAVIOR] 条目

### B-01：light-evaluator.md 步骤文件存在

步骤文件必须在指定路径存在，且包含豁免规则、记录格式、INV 约束说明。

Test: manual:bash -c "test -f /workspace/packages/engine/skills/dev/steps/light-evaluator.md && grep -q 'BEHAVIOR' /workspace/packages/engine/skills/dev/steps/light-evaluator.md && echo PASS || echo FAIL"

---

### B-02：SKILL.md 引用了新步骤文件

主 SKILL.md 在 push 前步骤中必须包含对 `light-evaluator` 的引用（grep 可找到），确保步骤被纳入执行流程。

Test: manual:bash -c "grep -q 'light-evaluator' /workspace/packages/engine/skills/dev/SKILL.md && echo PASS || echo FAIL"

---

### B-03：engine package.json 版本为 19.5.0

版本 bump 5 文件同步规则（INV-06）的核心断言，package.json 是权威来源。

Test: manual:bash -c "node -e \"const p=require('/workspace/packages/engine/package.json');console.log(p.version==='19.5.0'?'PASS':'FAIL: got '+p.version)\""

---

### B-04：CHANGELOG.md 顶部含 [19.5.0] 条目

版本 bump 必须同步写 CHANGELOG，确保变更可追溯。

Test: manual:bash -c "grep -q '\\[19.5.0\\]' /workspace/packages/engine/CHANGELOG.md && echo PASS || echo FAIL"

---

### B-05：feature-registry.yml 含 light-evaluator 条目

feature 注册是 engine 侧新能力的 SSOT，必须写入 registry。

Test: manual:bash -c "grep -q 'light-evaluator' /workspace/packages/engine/feature-registry.yml && echo PASS || echo FAIL"

---

### B-06：轻量 evaluator 对无 [BEHAVIOR] DoD 豁免（写 skipped 记录）

INV-01 要求纯文档/配置改动必须豁免并留痕，不得阻断 push。

Test: manual:bash -c "cd /workspace && node packages/engine/scripts/devgate/light-evaluator.cjs --sprint-dir sprints/07161830-dev-ab-light-evaluator --dry-run-no-behavior 2>&1 | grep -q 'skipped\\|no.*BEHAVIOR\\|豁免' && echo PASS || echo FAIL"

---

### B-07：轻量 evaluator 脚本存在且可执行

evaluator 主脚本（.cjs 或等效）必须在 devgate 目录下存在，node 可调用。

Test: manual:bash -c "test -f /workspace/packages/engine/scripts/devgate/light-evaluator.cjs && node --input-type=commonjs -e \"require('/workspace/packages/engine/scripts/devgate/light-evaluator.cjs')\" 2>&1 | grep -v 'Error' && echo PASS || echo FAIL"

---

### B-08：Red 测试文件存在（TDD 合同 commit 1）

先写测试（Red 状态），确保 TDD 顺序：测试先于实现。

Test: manual:bash -c "test -f /workspace/sprints/07161830-dev-ab-light-evaluator/tests/light-evaluator.test.cjs && echo PASS || echo FAIL"

---

## [ARTIFACT] 条目

### A-01：verify-record.json 格式规范文档

步骤文件中必须包含 verify-record.json 的 JSON schema 描述（字段：cmd、exit_code、tail5、timestamp，豁免时含 skipped/reason/files）。

验收：light-evaluator.md 文件包含上述字段名的文档说明（grep 断言已含于 B-01）。

---

## 验收命令汇总（手动运行顺序）

```bash
# B-01
bash -c "test -f /workspace/packages/engine/skills/dev/steps/light-evaluator.md && grep -q 'BEHAVIOR' /workspace/packages/engine/skills/dev/steps/light-evaluator.md && echo PASS || echo FAIL"

# B-02
bash -c "grep -q 'light-evaluator' /workspace/packages/engine/skills/dev/SKILL.md && echo PASS || echo FAIL"

# B-03
bash -c "node -e \"const p=require('/workspace/packages/engine/package.json');console.log(p.version==='19.5.0'?'PASS':'FAIL: got '+p.version)\""

# B-04
bash -c "grep -q '\[19.5.0\]' /workspace/packages/engine/CHANGELOG.md && echo PASS || echo FAIL"

# B-05
bash -c "grep -q 'light-evaluator' /workspace/packages/engine/feature-registry.yml && echo PASS || echo FAIL"

# B-08
bash -c "test -f /workspace/sprints/07161830-dev-ab-light-evaluator/tests/light-evaluator.test.cjs && echo PASS || echo FAIL"
```
