# Contract DoD: codex_test_gen 生成器空 description 修复

**Sprint ID**: 07180825-codex-gen-description-fix
**Task ID**: c3528706-8c83-4df0-a2af-31e6483ec05f
**DoD 版本**: v1
**日期**: 2026-07-18

---

## 验收标准（Definition of Done）

### [BEHAVIOR] B-1：入队 body 含非空 description（INV-1、INV-2、FR-1）

`runCodexTestGen` 调用 `POST /api/brain/tasks` 时，入队 body 的 `description` 字段：
- 非空（不为 `undefined` / `null` / 空字符串）
- 长度 >= 20 字符
- 包含 `targetFile` 路径字符串（如 `packages/brain/src/drain.js`）

**验证方式**：新增单元测试 `codex-test-gen-description.test.js`，mock fetch 捕获 body，断言以上三点。

---

### [BEHAVIOR] B-2：description 含 vitest 关键词（INV-4、FR-1、NFR-4）

入队 body 的 `description` 字段包含字符串 `vitest`（不区分大小写匹配即可），体现测试生成目标。

**验证方式**：单元测试断言 `body.description.toLowerCase().includes('vitest') === true`。

---

### [BEHAVIOR] B-3：payload 含 candidate_test_paths 非空数组（INV-3、FR-2）

入队 body 的 `payload.candidate_test_paths`：
- 为数组类型
- 长度 >= 1
- 数组元素含 `.test.js` 后缀路径
- 路径与 `target_file` 的 stem 对应（如 `drain.js` → `__tests__/drain.test.js`）

**验证方式**：单元测试断言 `Array.isArray(body.payload.candidate_test_paths) && body.payload.candidate_test_paths.length > 0`。

---

### [BEHAVIOR] B-4：priority 为合法值 P2（INV-5、FR-3）

入队 body 的 `priority` 字段值为 `'P2'`，不再为 `'P3'`（非法值）。

此修复确保入队任务能通过 preflight 的 priority 检查（`validPriorities = ['P0','P1','P2']`）。

**验证方式**：单元测试断言 `body.priority === 'P2'`。

---

### [BEHAVIOR] B-5：构造的任务对象通过 preFlightCheck（INV-1 + INV-5 联合验证）

使用修复后的字段构造任务对象，调用 `preFlightCheck`：
- `passed === true`
- `issues` 数组为空（长度 = 0）

**验证方式**：单元测试或集成测试中调用 `preFlightCheck`，断言 `result.passed === true && result.issues.length === 0`。

---

### [BEHAVIOR] B-6：5 个 blocked 任务解封后 status=queued（INV-6、FR-5、FR-6）

执行修补脚本 `repair-blocked-tasks.js` 后，5 个 blocked 任务（ID 前缀：`83fc5def`、`613aa09e`、`f4bd8692`、`06e1b20e`、`433b3625`）：
- `status` 变为 `'queued'`
- `description` 字段非空（IS NOT NULL）
- `metadata.pre_flight_fail_count === 0`
- `blocked_at`、`blocked_reason`、`blocked_detail` 已清空

**验证方式**：修补脚本末尾打印验证摘要，或执行 manual:bash 验收命令。

---

### [BEHAVIOR] B-7：TDD Red 阶段——修复前新测试 FAIL（FR-4）

在代码修复（Step 2）**之前**，运行新建的 `codex-test-gen-description.test.js`，B-1 到 B-4 相关断言必须 FAIL（Red 阶段验证）。

**验证方式**：在 Git 历史中保留"Red 阶段 commit"（仅含测试，无修复代码），CI 记录该 commit 下测试失败状态。

---

### [BEHAVIOR] B-8：回归验证——既有测试全过（INV-7、INV-8、NFR-1）

修复完成后运行以下两个测试集，零失败：
- `packages/brain/src/__tests__/codex-test-gen.test.js`（黑名单过滤 + 去重判断）
- `tests/regression/07172225-codex-pool-activation/codex-test-gen.test.ts`（codex 池激活回归）

**验证方式**：见 manual:bash 验收命令。

---

## manual:bash 验收命令

以下命令在 `/workspace` 目录下执行，所有命令必须成功（exit code 0，无 FAIL 输出）。

### Step 1：确认 Red 阶段（修复前新测试应 FAIL）

```bash
# 在实施代码修复前运行，期望看到 FAIL 输出
cd /workspace && npx vitest run packages/brain/src/__tests__/codex-test-gen-description.test.js 2>&1 | tail -20
```

### Step 2：运行新测试（修复后应全部 PASS）

```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/codex-test-gen-description.test.js
```

### Step 3：运行既有回归测试

```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/codex-test-gen.test.js
```

```bash
cd /workspace && npx vitest run tests/regression/07172225-codex-pool-activation/codex-test-gen.test.ts
```

### Step 4：执行修补脚本（解封 5 个 blocked 任务）

```bash
node /workspace/sprints/07180825-codex-gen-description-fix/repair-blocked-tasks.js
```

### Step 5：验证 5 个任务解封状态

```bash
curl -s "http://localhost:5221/api/brain/tasks?status=queued&limit=50" | \
  python3 -c "
import json, sys
tasks = json.load(sys.stdin)
target_ids = {'83fc5def', '613aa09e', 'f4bd8692', '06e1b20e', '433b3625'}
found = [t for t in tasks if any(t['id'].startswith(i) for i in target_ids)]
for t in found:
    desc_ok = bool(t.get('description') and len(t['description'].strip()) >= 20)
    print(f\"  ID={t['id'][:8]} status={t['status']} desc_ok={desc_ok}\")
print(f'已解封并含 description: {len(found)}/5')
assert len(found) == 5, f'期望 5 个，实际 {len(found)} 个'
print('PASS: 5 个任务全部解封')
"
```

### Step 6：验证修复后入队字段合规性（可选 smoke test）

```bash
# 通过 Brain API 查询最新 codex_test_gen 任务，确认 description 非空
curl -s "http://localhost:5221/api/brain/tasks?task_type=codex_test_gen&status=queued&limit=5" | \
  python3 -c "
import json, sys
tasks = json.load(sys.stdin)
for t in tasks[:3]:
    desc = t.get('description', '')
    priority = t.get('priority', '')
    has_vitest = 'vitest' in (desc or '').lower()
    print(f\"  ID={t['id'][:8]} priority={priority} desc_len={len(desc)} has_vitest={has_vitest}\")
print('PASS: 字段检查完成')
"
```

---

## 铁律覆盖确认

| 铁律 | 覆盖验收标准 | 状态 |
|------|-------------|------|
| ① 建任务时 description 非空且含目标文件路径 | B-1、B-2 | 覆盖 |
| ② preflight 检查可通过（不被三振 blocked）| B-5 | 覆盖 |
| ③ failing test 先写（TDD 红→绿顺序）| B-7 | 覆盖 |
| ④ 5 个 blocked 任务修补脚本包含在实现中 | B-6 | 覆盖 |
| ⑤ 既有测试全过（回归不破坏）| B-8 | 覆盖 |
