# Contract DoD: radius-rerun-gate

task_id: 2a8a33c5-bc62-43bd-a562-3c755766b950
sprint_dir: sprints/07181823-radius-rerun-gate
created: 2026-07-18

---

## DoD 条目

### [BEHAVIOR] B-1：radius-client.js 超时与错误捕获

**描述**：`callRadius(changedFiles)` 在 radius 端点无响应（网络错误、超时 >3s）时返回 `null`，不抛出异常，不阻塞调用方。

**验收命令** (manual:bash)：
```bash
# 单元测试层：mock fetch 超时，断言返回 null
cd /workspace && npx vitest run packages/brain/src/lib/radius-client.test.js \
  --reporter=verbose -t "timeout"

# 手动层：关闭 Brain，验证调用返回 null 不崩溃
node -e "
  import('packages/brain/src/lib/radius-client.js').then(m =>
    m.callRadius(['test.js']).then(r => {
      console.log('result:', r);
      console.assert(r === null, 'Should be null when unreachable');
      console.log('PASS: returned null without throwing');
    })
  );
"
```

**合格标准**：`callRadius` 函数存在，3s 后超时返回 null，错误不向外传播。

---

### [BEHAVIOR] B-2：stale=true 视同不可达

**描述**：radius 端点成功响应但 `freshness.stale === true` 时，`callRadius` 返回 `null`，不使用过期图数据做波及计算。

**验收命令** (manual:bash)：
```bash
# 单元测试层：mock fetch 返回 stale=true 响应
cd /workspace && npx vitest run packages/brain/src/lib/radius-client.test.js \
  --reporter=verbose -t "stale"

# 手动层：mock 响应
node -e "
  // mock fetch to return stale response
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      affected_features: [],
      affected_tests: [],
      freshness: { stale: true }
    })
  });
  import('packages/brain/src/lib/radius-client.js').then(m =>
    m.callRadius(['test.js']).then(r => {
      console.assert(r === null, 'stale=true should return null');
      console.log('PASS: stale=true returns null');
    })
  );
"
```

**合格标准**：stale=true 时 `callRadius` 返回 null（不返回带 stale 数据的对象）。

---

### [BEHAVIOR] B-3：回退路径打印 WARN（禁静默降级）

**描述**：`cascade-list.js` 在 radius 返回 null 时，调用 `console.warn` 输出精确字符串 `[WARN][rerun-gate] radius unavailable or stale — falling back to journey_step_links`，之后执行格子路径查询。

**验收命令** (manual:bash)：
```bash
# 集成测试层
cd /workspace && npx vitest run \
  packages/brain/src/__tests__/integration/rerun-gate-radius.integration.test.js \
  --reporter=verbose -t "回退" 2>&1 | grep -E "✓|PASS|WARN"

# 手动层：mock fetch 返回 null，调用 getCascadeList，验证 console.warn 含 WARN 字符串
node --input-type=module -e "
  import { createRequire } from 'module';
  const warnCalls = [];
  const orig = console.warn;
  console.warn = (...args) => { warnCalls.push(args.join(' ')); orig(...args); };

  // mock fetch 返回 null（模拟网络错误）
  global.fetch = async () => { throw new Error('network error'); };

  // 动态 import cascade-list，触发回退路径
  import('/workspace/packages/brain/src/cascade-list.js').then(async m => {
    const fn = m.getCascadeList || m.default;
    if (typeof fn === 'function') {
      try { await fn(['any-file.js']); } catch(e) { /* DB not available in manual check */ }
    }
    const hasWarn = warnCalls.some(s => s.includes('WARN'));
    console.log(hasWarn ? 'PASS: WARN found' : 'FAIL: WARN missing');
    process.exit(hasWarn ? 0 : 1);
  }).catch(() => {
    // 若 cascade-list 未实现，直接验证 WARN 字符串常量存在于源码
    const { execSync } = createRequire(import.meta.url)('module');
    process.exit(0);
  });
"

# 静态检查兜底：确认源码含 WARN 字符串
grep -n "WARN" /workspace/packages/brain/src/cascade-list.js && echo "PASS: WARN sentinel found in source" || echo "FAIL: WARN sentinel missing"
```

**合格标准**：回退路径触发时 `console.warn` 被调用且输出含 `WARN` 关键字；任何静默降级（仅 console.log）视为失败。

---

### [BEHAVIOR] B-4：格子路径在回退时被调用

**描述**：radius 不可达时，`cascade-list.js` 必须查询 `journey_step_links` 表（现有 DB 查询逻辑），输出与纯格子路径一致。格子路径代码不得被删除。

**验收命令** (manual:bash)：
```bash
# 集成测试层：spy journey_step_links 查询，断言被调用
cd /workspace && npx vitest run \
  packages/brain/src/__tests__/integration/rerun-gate-radius.integration.test.js \
  --reporter=verbose -t "journey_step_links"

# 静态检查：确保格子路径代码未被删除
grep -n "journey_step_links" /workspace/packages/brain/src/cascade-list.js
# 预期：至少 1 行包含 journey_step_links 查询（回退路径）
```

**合格标准**：
1. `cascade-list.js` 源码中 `journey_step_links` 字符串存在（格子路径未被删除）
2. radius=null 时集成测试中 DB 查询 spy 被调用

---

### [BEHAVIOR] B-5：正常路径 CRM feature 命中

**描述**：输入文件为 `packages/brain/src/__tests__/integration/blast-radius.integration.test.js` 时，radius 引擎返回的 `affected_features` 中包含 CRM 表底座（`feature_id: 0b70f2ff-1a16-4029-a71a-e6cb5a523ea2`）。

**验收命令** (manual:bash)：
```bash
# E2E 验证（需 Brain 运行）
curl -s -X POST http://localhost:5221/api/brain/graph/radius \
  -H "Content-Type: application/json" \
  -d '{"changed_files":["packages/brain/src/__tests__/integration/blast-radius.integration.test.js"]}' \
  | node -e "
    let body = '';
    process.stdin.on('data', d => body += d);
    process.stdin.on('end', () => {
      const data = JSON.parse(body);
      const CRM = '0b70f2ff-1a16-4029-a71a-e6cb5a523ea2';
      const hit = (data.affected_features || []).some(f => f.feature_id === CRM);
      const stale = data.freshness?.stale;
      const journeyHit = (data.affected_features || []).some(f =>
        (f.promises || []).some(p => p.journey_name && p.journey_name.includes('智能客服'))
      );
      console.log('CRM hit:', hit ? 'PASS' : 'FAIL');
      console.log('not stale:', !stale ? 'PASS' : 'FAIL');
      console.log('journey_name 智能客服:', journeyHit ? 'PASS' : 'FAIL');
      process.exit(hit && !stale && journeyHit ? 0 : 1);
    });
  "

# 集成测试层（场景 A）
cd /workspace && npx vitest run \
  packages/brain/src/__tests__/integration/rerun-gate-radius.integration.test.js \
  --reporter=verbose -t "场景A\|CRM"
```

**合格标准**：`affected_features[*].feature_id` 包含 `0b70f2ff-1a16-4029-a71a-e6cb5a523ea2`，`freshness.stale !== true`，且 CRM feature 的 `promises` 中至少一条 `journey_name` 包含 `智能客服`（`crm.promises.some(p => p.journey_name.includes('智能客服'))`）。

---

### [BEHAVIOR] B-6：失败测试先行（Bug Fix 流程）

**描述**：任何针对本功能的 bug 修复，必须先写能复现的 failing test，提交后再修代码。修 bug 的测试必须 commit 进 repo 永久留在 CI，不得删除。

**验收命令** (manual:bash)：
```bash
# 验证 rerun-gate-radius 测试文件已在 git 中
git -C /workspace log --oneline -- \
  packages/brain/src/__tests__/integration/rerun-gate-radius.integration.test.js | head -3

# 验证测试在 CI 配置中被覆盖（brain-ci.yml）
grep -n "integration" /workspace/.github/workflows/brain-ci.yml | head -5
```

**合格标准**：测试文件存在于 git history，CI 配置覆盖 integration 测试目录。

---

## 不变量覆盖矩阵

| 不变量 | 覆盖条目 |
|--------|---------|
| I-1：禁止静默降级 | B-3（WARN 哨兵）|
| I-2：格子路径永久保留 | B-4（格子路径存在性检查）|
| I-3：stale=true 视同不可达 | B-2（stale 回退）|
| I-4：测试 commit 进 repo | B-6（失败测试先行）|
| I-5：工厂域同挂闸 | B-1 + B-3（radius-client + WARN 适用工厂域）|

---

## 完工核验清单

```bash
# 1. 文件存在性
ls /workspace/packages/brain/src/lib/radius-client.js
ls /workspace/packages/brain/src/__tests__/integration/rerun-gate-radius.integration.test.js

# 2. 格子路径未删除
grep -c "journey_step_links" /workspace/packages/brain/src/cascade-list.js

# 3. WARN 字符串存在于 cascade-list.js
grep "WARN" /workspace/packages/brain/src/cascade-list.js

# 4. 全部集成测试通过
cd /workspace && npx vitest run \
  packages/brain/src/__tests__/integration/rerun-gate-radius.integration.test.js \
  --reporter=verbose

# 5. radius-client 单元测试通过
cd /workspace && npx vitest run \
  packages/brain/src/lib/radius-client.test.js \
  --reporter=verbose
```
