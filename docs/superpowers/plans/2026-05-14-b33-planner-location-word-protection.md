# B33 Planner 位置词死规则 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `harness-planner/SKILL.md` Step 0 中追加"位置词死规则"，防止 planner 把 thin_prd 的模块位置词（playground/brain/dashboard）漂移到错误模块。

**Architecture:** 纯文档规则修改，在 Step 0 主题词死规则后插入新子节，格式与 B20 完全一致（死规则 + 自查 checklist + 违规/正确示例）。版本从 8.3.0 → 8.4.0。

**Tech Stack:** Markdown 文件编辑，node -e 验证

---

### Task 1: 修改 SKILL.md — 插入位置词死规则 + 版本 bump

**Files:**
- Modify: `packages/workflows/skills/harness-planner/SKILL.md`（第 1-18 行 version/changelog，第 78-79 行 Step 0 末尾插入）

- [ ] **Step 1: 在 Step 0 末尾（第 78 行 `---` 前）插入位置词死规则子节**

在 `packages/workflows/skills/harness-planner/SKILL.md` 第 78 行 `---` 前，插入以下内容（在当前"正确示例"那段 `✅` 行之后）：

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
- [ ] 禁止跨模块漂移（playground → brain route / brain route → playground）

**违规示例**（禁止）：

- thin_prd "playground 加 GET /ping" → PRD 写 `packages/brain/src/routes/status.js` 加 `/api/brain/ping` ❌

**正确示例**：

- thin_prd "playground 加 GET /ping" → PRD 写 `playground/server.js` 加 `GET /ping` ✅

```

- [ ] **Step 2: 同文件 — 更新 version 和 changelog**

文件顶部 frontmatter：

```yaml
version: 8.4.0
updated: 2026-05-14
```

在 changelog 列表最前面加：

```yaml
  - 8.4.0: Step 0 位置词死规则（B33 — W43 实证）— planner 把 playground 漂移到 brain route，强制 thin_prd 位置词原样映射到实现模块
```

- [ ] **Step 3: 验证 SKILL.md 包含新规则（DoD 行为验证）**

```bash
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('位置词死规则'))process.exit(1);console.log('OK')"
```

预期输出：`OK`

- [ ] **Step 4: 验证版本号已更新**

```bash
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('8.4.0'))process.exit(1);console.log('version OK')"
```

预期输出：`version OK`

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/skills/harness-planner/SKILL.md
git commit -m "fix(planner): 位置词死规则 (B33 — W43 实证)"
```

---

### Task 2: 写 Learning 文件

**Files:**
- Create: `docs/learnings/cp-0514093421-B33-planner-location-word-protection.md`

- [ ] **Step 1: 创建 learning 文件**

```bash
cat > docs/learnings/cp-0514093421-B33-planner-location-word-protection.md << 'EOF'
# B33 — Planner 位置词死规则（W43 实证）

## 根本原因

thin_prd 含位置词 "playground" 时，Planner 未识别位置约束，把 endpoint 写到了
`packages/brain/src/routes/status.js`（`GET /api/brain/ping`），而非 thin_prd 指定的
`playground/server.js`（`GET /ping`）。

B20 的主题词死规则只防止 endpoint 名称漂移，不防止模块位置漂移。

## 下次预防

- [ ] thin_prd 含位置词时，planner Step 0 第二件事检查位置词 → 映射到对应模块
- [ ] 四个位置词映射关系已固化到 SKILL.md Step 0 位置词死规则（B33）
- [ ] 测试 thin_prd 含 "playground" 时，generator PR 的改动文件必须在 playground/ 下
EOF
```

- [ ] **Step 2: Commit**

```bash
git add docs/learnings/cp-0514093421-B33-planner-location-word-protection.md
git commit -m "docs(learnings): B33 位置词死规则根因记录"
```

---

### Task 3: DevGate 检查 + PR

- [ ] **Step 1: 运行 DevGate（SKILL.md 改动不涉及 Brain 核心，跳过 brain 相关，但 Engine DoD 需检查）**

```bash
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```

如果因为没有 PRD.md/DoD 文件报错，在 worktree 根目录创建 `PRD.md`：

```bash
cat > PRD.md << 'EOF'
## 成功标准

- [x] [BEHAVIOR] SKILL.md 含"位置词死规则"关键字
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('位置词死规则'))process.exit(1)"
- [x] [ARTIFACT] SKILL.md 版本升至 8.4.0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('8.4.0'))process.exit(1)"
EOF
```

- [ ] **Step 2: Push + 创建 PR**

```bash
git push -u origin cp-0514093421-B33-planner-location-word-protection
gh pr create \
  --title "fix(planner): 位置词死规则 (B33 — W43 实证)" \
  --body "$(cat PRD.md)"
```
