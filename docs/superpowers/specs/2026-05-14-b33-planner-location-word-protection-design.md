# B33 — Planner 位置词死规则设计

**日期**: 2026-05-14  
**任务**: B33  
**影响文件**: `packages/workflows/skills/harness-planner/SKILL.md`

---

## 根因

W43 实证：thin_prd "playground 加 GET /ping" → Planner 输出 `packages/brain/src/routes/status.js` 新增 `/api/brain/ping`，而非 `playground/server.js`。

B20 的主题词死规则（Step 0）防止 endpoint 名称漂移（/ping→/health-check），但不防止模块位置漂移（playground→Brain）。

---

## 设计

### 插入位置

`SKILL.md` Step 0 末尾（第 78 行 `---` 分隔符前），紧接主题词死规则，追加"位置词死规则"子节。

### 规则内容

```markdown
### 位置词死规则（B33 — W43 实证）

**第二件事**：检查 thin_prd 是否含**位置词**（模块/目录名），保证实现落在正确模块。

**死规则**：

1. thin_prd 含 "playground" → 代码必须写在 `playground/server.js`，禁止放 `packages/brain/src/`
2. thin_prd 含 "Brain" / "brain" / "Brain API" → 代码写在 `packages/brain/src/`
3. thin_prd 含 "dashboard" → 代码写在 `apps/dashboard/`
4. thin_prd 含 "apps/api" → 代码写在 `apps/api/`
5. thin_prd 无明确位置词 → 遵循 Step 0.5 journey_type 推断

**自查 checklist**（写完 sprint-prd.md 后必 grep）：

- [ ] thin_prd 含哪个位置词 → PRD 的实现位置描述必须与之一致
- [ ] 禁止跨模块漂移

**违规示例**：thin_prd "playground 加 GET /ping" → PRD 写 Brain route ❌  
**正确示例**：thin_prd "playground 加 GET /ping" → PRD 写 playground/server.js ✅
```

---

## 测试策略

trivial 变更（纯文档规则，无运行时逻辑）：

- `[BEHAVIOR] manual:node -e` 读文件验证含"位置词死规则"关键字
- `[ARTIFACT]` SKILL.md 文件存在且版本升到 8.4.0

---

## 版本 bump

`SKILL.md` version: `8.3.0` → `8.4.0`

changelog 条目：
```
- 8.4.0: Step 0 位置词死规则（B33 — W43 实证）— planner 把 playground 漂移到 brain route，强制 thin_prd 位置词原样映射到实现模块
```
