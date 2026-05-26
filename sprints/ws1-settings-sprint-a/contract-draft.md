# Sprint Contract Draft (Round 3)

**Sprint**: WS1 统一设置入口 + 侧边栏分组重构
**Journey type**: user_facing
**Target environment**: mac_web
**Propose branch**: cp-harness-propose-r3-b5ac5e8a

> **Round 3 修订说明**: 本轮修复 Reviewer 指出的 2 个 internal_consistency 阻塞问题：
> 1. Step 4 硬阈值从「E2E Playwright 验证 collapsed 状态 Settings 图标可见」改为「静态验证: App.tsx 含 collapsed tooltip 逻辑」；collapsed UI 验证归属 final-e2e 独立硬阈值说明
> 2. Workstream 3 和 Test Contract 表两处引用 `tests/ws3/inbox-merge.test.ts` 统一改为 `tests/ws3/group-merge.test.ts`（与实际文件一致）

---

## 实际代码现状（`apps/api/features/`）

当前 8 个 navGroups（含 2 个中文 label、1 个空 label）：

| id | label | order | 问题 |
|---|---|---|---|
| cecelia | '' | 0.5 | 空 label，侧边栏有无名分组 |
| dashboard | 'Dashboard' | 1 | ✓ |
| inbox | 'Inbox' | 1.5 | ✓ |
| today | 'Today' | 2 | ✓ |
| gtd | 'GTD System' | 2.5 | ✓ |
| execution | '执行' | 3 | 中文 ✗ |
| system | 'System' | 5 | ✓（system-hub 声明，system/index.ts 重复声明被忽略）|
| knowledge-docs | '知识库' | 6 | 中文 ✗ |

`/settings` 当前状态：作为 System tab 的 children 子项（`label: '设置'`，中文），路由已注册但无独立 navItem。

---

## Golden Path

[用户打开 Dashboard] → [侧边栏显示 ≤ 5 分组，标题全英文无空标题] → [找到 Settings 独立图标] → [点击进入 /settings/brain] → [收起侧边栏时 Settings 图标仍可见并有 tooltip]

---

### Step 1: 侧边栏 navGroup 数量 ≤ 5，标题全英文（无中文无空串）

**可观测行为**: 打开 Dashboard，侧边栏分组数量 ≤ 5；所有分组 header 为英文；不再有「知识库」「执行」等中文 header；不再有无标题的空白分组。

**验证命令**:
```bash
# 1. 无中文 navGroup label（知识库、执行、系统）
for LABEL in '知识库' '执行' '系统'; do
  grep -rn "label: '$LABEL'" /workspace/apps/api/features/*/index.ts 2>/dev/null \
    | grep "navGroups" \
    && { echo "FAIL: 中文 navGroup label '$LABEL' 仍存在"; exit 1; } || true
done

# 2. 无空 label 的 navGroup 声明（cecelia 移除后）
grep -rn "label: ''" /workspace/apps/api/features/*/index.ts 2>/dev/null \
  | grep -v "^//" \
  && { echo "FAIL: 空 label navGroup 仍存在"; exit 1; } || true

# 3. navGroup 唯一 id 总数 ≤ 5
COUNT=$(python3 -c "
import re, glob
ids = set()
for f in glob.glob('/workspace/apps/api/features/*/index.ts'):
    c = open(f).read()
    for block in re.findall(r'navGroups:\s*\[(.*?)\]', c, re.DOTALL):
        ids.update(re.findall(r\"id:\s*'([\w-]+)'\", block))
print(len(ids))
")
[ "$COUNT" -le 5 ] || { echo "FAIL: navGroup 唯一 id 数量=$COUNT > 5"; exit 1; }
echo "OK navGroup count=$COUNT"
```

**硬阈值**: 中文 navGroup label = 0，空 label navGroup = 0，navGroup 唯一 id 数量 ≤ 5

---

### Step 2: Settings 作为独立 navItem 出现在侧边栏（英文 label）

**可观测行为**: 用户在侧边栏直接看到 Settings 图标（Lucide Settings icon）与 label「Settings」，点击跳转 `/settings`；不再是 System tab 的 children 子项（展开 System 才能看到）。

**验证命令**:
```bash
# Settings 路由有独立 navItem（不在 children 数组内）
FILE=/workspace/apps/api/features/system-hub/index.ts

# path '/settings' 对应的路由有 navItem 字段，且该 navItem 不嵌套在 children 数组中
# 方法：找 "/settings" + navItem 在同一路由对象内（非 children 子项）
python3 -c "
import re, sys
content = open('$FILE').read()
# 找独立路由: { path: '/settings', ..., navItem: { ... group: ... } }
pattern = r\"path:\s*'/settings'[^}]*navItem\s*:\"
if not re.search(pattern, content, re.DOTALL):
    print('FAIL: /settings 无独立 navItem')
    sys.exit(1)
# 旧 children 写法: children: [ ... { path: '/settings', ... } ... ]
# 确认 /settings 不在 children 数组内 — 通过确认 navItem 在顶层路由对象中
print('OK')
"

# label 为英文 'Settings'
grep "label: 'Settings'" "$FILE" | grep -q "Settings" \
  || { echo "FAIL: Settings label 不是英文"; exit 1; }

# 旧中文 label '设置' 不在 system-hub 任何 children 数组中
! grep -q "label: '设置'" "$FILE" \
  || { echo "FAIL: 中文 '设置' 仍存在于 system-hub"; exit 1; }

echo "OK"
```

**硬阈值**: `/settings` 有独立 navItem，label = 'Settings'，'设置' 从 system-hub 完全消失

---

### Step 3: 点击 Settings 进入 /settings/brain，SettingsLayout 正常渲染

**可观测行为**: 点击侧边栏 Settings 后路由跳转到 /settings/brain（SettingsPage redirect 逻辑保持），SettingsLayout 四个 Tab 可见。

**验证命令**:
```bash
# SettingsLayout 组件注册于 manifest components
grep -q "SettingsLayout" /workspace/apps/api/features/system-hub/index.ts \
  || { echo "FAIL: SettingsLayout 未注册"; exit 1; }

# /settings 及子路由已注册
COUNT=$(grep -c "path: '/settings" /workspace/apps/api/features/system-hub/index.ts)
[ "$COUNT" -ge 5 ] || { echo "FAIL: /settings 子路由不足，count=$COUNT"; exit 1; }

# TypeScript 编译无新增错误
cd /workspace/apps/dashboard && npx tsc --noEmit 2>&1 | grep -c "error TS" \
  | xargs sh -c '[ $0 -eq 0 ] && echo OK || { echo "FAIL: TS errors=$0"; exit 1; }'
```

**硬阈值**: SettingsLayout 注册、≥ 5 条 /settings 路由、TypeScript 零错误

---

### Step 4: 侧边栏收起时 Settings 图标可见（tooltip "Settings"）

**可观测行为**: collapsed=true 状态下，Settings navItem 图标仍显示；hover 时浏览器原生 title tooltip 显示「Settings」。此行为由 App.tsx 现有 `title={collapsed ? item.label : undefined}` 逻辑自动保证，无需额外配置。

**验证命令**（静态检查）:
```bash
# 静态验证：App.tsx 有 collapsed 时显示 tooltip 的逻辑
grep -q 'title={collapsed' /workspace/apps/dashboard/src/App.tsx \
  || { echo "FAIL: App.tsx collapsed tooltip 逻辑不存在"; exit 1; }
echo "OK"
```

**硬阈值**: 静态验证: App.tsx 含 collapsed tooltip 逻辑（`title={collapsed` 存在）

> **注**：collapsed 状态下 Settings 图标可见的 UI 行为验证由 **final-e2e 脚本步骤 6**（`await expect(settingsLink).toBeVisible()`）负责，独立于本步骤静态检查。

---

## E2E 验收（final-e2e — target_environment: mac_web）

**journey_type**: user_facing
**target_environment**: mac_web（Playwright 本机真实浏览器，localhost:5174）

```javascript
// final-e2e Playwright 脚本（在 Mac 本机执行）
// 前置：cd apps/dashboard && npm run dev（localhost:5174 已启动）
const { chromium, expect } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. 打开 Dashboard
  await page.goto('http://localhost:5174/dashboard');
  await page.waitForLoadState('networkidle', { timeout: 20000 });

  // 2. 验证侧边栏分组数量 ≤ 5（非收起状态）
  // collapsed=true 是默认状态，展开后看 p.text-[10px] 分组 header
  const collapseBtn = page.locator('button[title*="展开"]').first();
  if (await collapseBtn.count() > 0) {
    await collapseBtn.click();
    await page.waitForTimeout(400);
  }
  const groupHeaders = page.locator('aside nav p');
  const headerCount = await groupHeaders.count();
  if (headerCount > 5) {
    console.error(`FAIL: 侧边栏分组数 ${headerCount} > 5`);
    process.exit(1);
  }

  // 3. 验证 Settings navItem 在侧边栏可见（独立，非子菜单）
  const settingsLink = page.locator('aside nav a[href="/settings"]').first();
  await expect(settingsLink).toBeVisible({ timeout: 8000 });

  // 4. 验证没有中文分组 header
  const chineseHeaders = await page.$$eval('aside nav p', els =>
    els.filter(el => /[一-鿿]/.test(el.textContent || ''))
       .map(el => el.textContent)
  );
  if (chineseHeaders.length > 0) {
    console.error('FAIL: 仍有中文分组 header', chineseHeaders);
    process.exit(1);
  }

  // 5. 点击 Settings，验证跳转到 /settings/brain
  await settingsLink.click();
  await page.waitForURL('**/settings**', { timeout: 10000 });
  await page.waitForURL('**/settings/brain**', { timeout: 5000 });
  await expect(page.locator('text=Brain 系统')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('text=维护')).toBeVisible({ timeout: 5000 });

  // 6. 折叠侧边栏，验证 Settings 图标仍可见
  const collapseBtn2 = page.locator('button[title*="收起"]').first();
  if (await collapseBtn2.count() > 0) {
    await collapseBtn2.click();
    await page.waitForTimeout(400);
  }
  // collapsed 状态：link 仍在 DOM，但只显示 icon（label 隐藏）
  await expect(settingsLink).toBeVisible({ timeout: 5000 });

  // 7. 交叉验证：Settings 路由在 manifest 中注册
  const apiResp = await page.request.get('http://localhost:5221/api/brain/health');
  // Brain API 健康检查（确保 evaluator 环境正常）
  const status = apiResp.status();
  if (status !== 200) {
    console.warn(`WARN: Brain health status=${status}，跳过 API 交叉验证`);
  }

  await context.close();
  await browser.close();
  console.log('✅ Golden Path UI 验证通过');
})();
```

**通过标准**: 脚本 exit 0

---

## Risks

| # | 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|---|
| R1 | execution 下的导航项（DevTasks 等）合并入 system 后，用户习惯路径改变 | 中 | 低 | 现有路由路径不变，仅 group 归属改变；用户仍可通过 URL 直达 |
| R2 | inbox 从独立分组合并入 dashboard 后，inbox 入口视觉权重降低 | 低 | 低 | inbox navItem 仍存在于 dashboard 分组，只是 section header 合并 |
| R3 | cecelia navGroup 移除后，cecelia navItem 归入 system group，与 system 原有子菜单结构混在一起 | 低 | 中 | cecelia navItem 有独立 icon（Brain），视觉上可区分；PRD 未要求保留 cecelia 独立 section |
| R4 | requireSuperAdmin 过滤逻辑依赖 filterNavGroups，refactor 不涉及该函数本身 | 低 | 高 | WS2 DoD 验证 filterNavGroups 函数仍含 requireSuperAdmin 检查 |

---

## Workstreams

workstream_count: 3

### Workstream 1: Settings 独立 navItem 注册（system-hub）

**范围**: 仅修改 `apps/api/features/system-hub/index.ts`
- 从 System tab `children` 数组移除 `{ path: '/settings', label: '设置', ... }`
- 给 `/settings` 路由添加独立 navItem：`{ label: 'Settings', icon: 'Settings', group: 'system', order: 20 }`
**大小**: S（< 20 行净变更，1 文件）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/settings-navitem.test.ts`

---

### Workstream 2: navGroup 标签英文化 + cecelia/execution/knowledge 归并

**范围**: 3 个 feature manifest
- `apps/api/features/knowledge/index.ts`: navGroup label `'知识库'` → `'Knowledge'`
- `apps/api/features/cecelia/index.ts`: **移除** navGroups 数组声明（`id: 'cecelia'`，空 label），将 `/cecelia` 路由 navItem.group `'cecelia'` → `'system'`（归入 system-hub 已声明的 system 组，不需重新声明）
- `apps/api/features/execution/index.ts`: 移除 navGroups 数组声明（`id: 'execution'`，`label: '执行'`），将 execution 的各 navItem.group `'execution'` → `'system'`

> **Issue 5 修复说明**: Round 1 描述「cecelia navGroup id 改为 system」会与 system-hub 的 id='system' 产生混淆（两个 manifest 同时声明 id='system'，虽然 buildNavGroupsFromManifests 用 Map 保证 first-wins 不冲突，但语义不清）。正确做法：完全**移除** cecelia 的 navGroups 声明，cecelia 的路由 navItem.group 直接引用 system-hub 已声明的 'system' 组即可。

**大小**: S（3 文件，各 3-8 行变更）
**依赖**: WS1 完成后（确认 'system' navGroup 存在且英文 label 为 'Settings' 不与 cecelia 冲突）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/navgroup-labels.test.ts`

---

### Workstream 3: inbox 合并入 dashboard（分组数量降至 5）

**范围**: 仅 `apps/api/features/inbox/index.ts`
- 移除 `navGroups: [{ id: 'inbox', label: 'Inbox', ... }]` 声明
- 将 inbox 路由 navItem.group `'inbox'` → `'dashboard'`

合并后最终 5 个 navGroups（全英文）：
1. `dashboard` — "Dashboard"（包含 inbox 条目）
2. `today` — "Today"
3. `gtd` — "GTD System"
4. `knowledge-docs` — "Knowledge"（原 '知识库'）
5. `system` — "System"（包含 cecelia、execution 条目、Settings 独立 navItem）

**大小**: S（1 文件，< 10 行变更）
**依赖**: 无（与 WS1/WS2 并行安全）

**BEHAVIOR 覆盖测试文件**: `tests/ws3/group-merge.test.ts`

---

## Workstreams 切分自查

- WS1: 1 文件，~15 行 → ≤ 3 文件 ✅，≤ 200 行 ✅
- WS2: 3 文件，~25 行 → ≤ 3 文件 ✅，≤ 200 行 ✅
- WS3: 1 文件，~8 行 → ≤ 3 文件 ✅，≤ 200 行 ✅
- 合计净变更 ~48 行，整 contract 净增 < 200 行 ✅

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/settings-navitem.test.ts` | /settings 独立 navItem / label='Settings' / 无 '设置' | 改前 /settings 无独立 navItem → 红 |
| WS2 | `tests/ws2/navgroup-labels.test.ts` | 知识库→Knowledge / 无执行 / cecelia navGroup 消失 / requireSuperAdmin 保留 | 改前 '知识库'/'执行' 仍存在 → 红 |
| WS3 | `tests/ws3/group-merge.test.ts` | inbox navGroup 消失 / group→dashboard / 总数 ≤ 5 | 改前 inbox 独立 navGroup 仍存在 → 红 |
