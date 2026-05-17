# OKR → Exploratory → Dev 完整执行闭环

## 📋 目录

1. [三层拆解层级](#三层拆解层级)
2. [完整执行流程](#完整执行流程)
3. [关键角色职责](#关键角色职责)
4. [文件传递机制](#文件传递机制)
5. [多 Initiative 并行](#多-initiative-并行)
6. [完整示例](#完整示例)

---

## 三层拆解层级

```
OKR/KR (目标层)
    ↓
Initiative (战略层)
    ↓
PR Plans (工程规划层) - sequence, depends_on
    ↓
Tasks (执行层) - type: exploratory / dev / review / qa / audit
```

### 各层职责

| 层级 | 负责人 | 产物 | 存储位置 |
|------|--------|------|----------|
| **OKR/KR** | 人工规划 | KR 描述 | Brain PostgreSQL (goals 表) |
| **Initiative** | 秋米 /okr | Initiative + PR Plans + Tasks | Brain PostgreSQL (projects, pr_plans, tasks) |
| **Exploratory** | Exploratory Agent | PRD + DOD | 主仓库 develop 分支 (.prd.md, .dod.md) |
| **Dev** | Dev Agent | 功能代码 | 主仓库 develop 分支 (通过 PR) |

---

## 完整执行流程

### Phase 1: OKR 拆解（秋米 /okr - Opus）

```
输入: KR "完成用户认证系统，支持 JWT 和第三方登录"
    ↓
秋米拆解:
    Initiative: "实现用户认证系统"
    ├── PR Plan 1 (sequence=1, depends_on=[])
    │   ├── Task 1.1: type=exploratory, "验证 JWT 可行性"
    │   ├── Task 1.2: type=dev, "实现 JWT 中间件"
    │   └── Task 1.3: type=dev, "添加 JWT 测试"
    │
    └── PR Plan 2 (sequence=2, depends_on=[PR Plan 1])
        ├── Task 2.1: type=exploratory, "验证第三方登录流程"
        └── Task 2.2: type=dev, "实现 OAuth 集成"
    ↓
存储: Brain PostgreSQL
    - projects 表: Initiative (id=init-123)
    - pr_plans 表: PR Plan 1 (id=pp-1, sequence=1), PR Plan 2 (id=pp-2, sequence=2, depends_on=[pp-1])
    - tasks 表: Task 1.1, 1.2, 1.3, 2.1, 2.2 (所有 status=queued)
```

**秋米拆解到什么程度**：
- ✅ Initiative (战略目标)
- ✅ PR Plans (工程边界，带依赖关系)
- ✅ Tasks (执行单元，title + type + 简单 description)
- ❌ **不生成 PRD/DoD**（这是 Exploratory 的工作）
- ❌ **不写代码**（这是 Dev 的工作）

---

### Phase 2: Brain Tick Loop 开始派发

```
Tick 1 (T+0min):
    planNextTask()
        → getNextPrPlan(init-123) → PR Plan 1 (sequence=1, no depends)
        → 查询 pr_plan_id=pp-1 的 queued tasks → Task 1.1
    dispatchTask(Task 1.1)
        → executor.js
        → cecelia-run
        → claude -p "/exploratory 验证 JWT 可行性"
    状态: Task 1.1 (queued → in_progress)
```

---

### Phase 3: Exploratory 执行（Task 1.1）

```
Exploratory Agent (无头, Opus):
    Step 1: 创建临时 worktree
        cd /home/xx/perfect21/cecelia/core
        git worktree add ../exploratory-jwt-1234 develop
        cd ../exploratory-jwt-1234

    Step 2: Hack 代码验证
        npm install jsonwebtoken
        # 写 hack 代码测试 JWT 生成和验证
        node test-jwt.js  # 能跑就行

    Step 3: 记录踩坑
        - JWT secret 需要环境变量
        - Token 过期时间设置为 24h
        - 需要 refresh token 机制

    Step 4: 生成 PRD + DOD
        基于跑通的代码生成:
            .prd-jwt-auth.md (10-20 行，包含 Why/What/How)
            .dod-jwt-auth.md (验收标准，测试清单)

    Step 5: 保存到主仓库
        cd /home/xx/perfect21/cecelia/core  # 回到主仓库
        cp ../exploratory-jwt-1234/.prd-jwt-auth.md .
        cp ../exploratory-jwt-1234/.dod-jwt-auth.md .
        git add .prd-jwt-auth.md .dod-jwt-auth.md
        git commit -m "docs: add JWT auth PRD/DOD from exploratory"
        git push origin develop

    Step 6: 清理 worktree
        git worktree remove ../exploratory-jwt-1234 --force

    Step 7: 回调 Brain
        curl -X POST localhost:5221/api/brain/execution-callback \
          -d '{"task_id":"task-1.1","status":"completed"}'

状态: Task 1.1 (in_progress → completed)
产物: .prd-jwt-auth.md, .dod-jwt-auth.md (在 develop 分支)
```

**Exploratory 拆解到什么程度**：
- ✅ hack 代码（临时，不进主线）
- ✅ 验证可行性（手动测试、curl 测试）
- ✅ 生成 PRD/DOD（完整的需求和验收标准）
- ✅ 记录踩坑（真实依赖、配置需求）
- ❌ **不创建 PR**
- ❌ **不走 CI**
- ❌ **不合并代码**

---

### Phase 4: Brain Tick Loop 继续派发

```
Tick 2 (T+15min, 假设 Exploratory 用了 15min):
    planNextTask()
        → getNextPrPlan(init-123) → 还是 PR Plan 1 (因为还有 queued tasks)
        → 查询 pr_plan_id=pp-1 的 queued tasks → Task 1.2
    dispatchTask(Task 1.2)
        → executor.js
        → cecelia-run
        → claude -p "/dev --task-id task-1.2"
    状态: Task 1.2 (queued → in_progress)
```

**关键**：同一个 PR Plan 的 Tasks 连续执行，不会跳到其他 PR Plan！

---

### Phase 5: Dev 执行（Task 1.2）

```
Dev Agent (无头, Opus):
    Step 1: 读取 Task PRD
        方式 1: /dev --task-id task-1.2
            → fetch-task-prd.sh 从 Brain API 读取 Task description
            → 生成临时 .prd-task-1.2.md

        方式 2: /dev
            → 检查主仓库是否有 .prd-jwt-auth.md ← Exploratory 生成的
            → 使用这个文件

    Step 2: 创建分支
        git checkout develop
        git pull
        git checkout -b cp-implement-jwt-middleware

    Step 3: 写干净代码
        # 基于 PRD 实现 JWT 中间件
        brain/src/middleware/jwt.js  # 干净、可维护
        brain/src/middleware/__tests__/jwt.test.js  # 完整测试

    Step 4: 本地测试
        npm test

    Step 5: 创建 PR
        git add .
        git commit -m "feat: implement JWT middleware"
        git push origin cp-implement-jwt-middleware
        gh pr create --title "feat: implement JWT middleware" --base develop

    Step 6: CI 验证
        等待 GitHub Actions 完成
        如果失败 → 分析错误 → 修复 → 重新 push → 重新等待

    Step 7: 合并 PR
        gh pr merge --squash --delete-branch

    Step 8: 回调 Brain
        curl -X POST localhost:5221/api/brain/execution-callback \
          -d '{"task_id":"task-1.2","status":"completed"}'

状态: Task 1.2 (in_progress → completed)
产物: JWT 中间件代码（已合并到 develop）
```

**Dev 走到什么程度**：
- ✅ 读取 PRD/DOD（从 Exploratory 或 Brain）
- ✅ 写干净代码（可维护、符合规范）
- ✅ 完整测试（单元测试 + 集成测试）
- ✅ 创建 PR
- ✅ CI 验证（DevGate 检查）
- ✅ 合并到 develop
- ✅ 自动修复所有问题（CI 失败、合并冲突、测试失败）
- ✅ **循环直到 PR 合并**（Stop Hook 保证）

---

### Phase 6: Brain Tick Loop 继续

```
Tick 3 (T+45min):
    planNextTask()
        → getNextPrPlan(init-123) → 还是 PR Plan 1
        → 查询 pr_plan_id=pp-1 的 queued tasks → Task 1.3
    dispatchTask(Task 1.3)
        → /dev --task-id task-1.3

Tick 4 (T+60min):
    Task 1.3 完成
    → checkPrPlansCompletion()
    → PR Plan 1 所有 Tasks 完成
    → updatePrPlanStatus(pp-1, 'completed')

Tick 5 (T+61min):
    planNextTask()
        → getNextPrPlan(init-123) → PR Plan 2 (sequence=2, depends_on=[pp-1] 已满足)
        → 查询 pr_plan_id=pp-2 的 queued tasks → Task 2.1
    dispatchTask(Task 2.1)
        → /exploratory "验证第三方登录流程"
        → 生成 .prd-oauth.md, .dod-oauth.md

Tick 6 (T+80min):
    planNextTask()
        → Task 2.2
    dispatchTask(Task 2.2)
        → /dev --task-id task-2.2
        → 使用 .prd-oauth.md
        → PR 合并

Tick 7 (T+120min):
    PR Plan 2 完成
    → Initiative 完成 ✅
```

---

## 关键角色职责

### 1️⃣ 秋米 /okr（规划大师）

**职责**：
- 拆解 KR → Initiative → PR Plans → Tasks
- 设计 PR Plan 的 sequence 和 depends_on
- 决定哪些 Tasks 是 exploratory，哪些是 dev

**拆解粒度**：
- Initiative: 战略目标（Why/What/Outcome）
- PR Plans: 工程边界（一个 PR 的范围）
- Tasks: 执行单元（title + type + 简单 description，10-20 字）

**不做**：
- ❌ 不生成 PRD/DOD
- ❌ 不写代码
- ❌ 不验证可行性

**示例**：
```json
{
  "initiative": {
    "title": "实现用户认证系统",
    "description": "Why: 支持多租户登录\nWhat: JWT + OAuth\nOutcome: 用户能登录",
    "repository": "cecelia-core"
  },
  "pr_plans": [
    {
      "title": "实现 JWT 认证",
      "sequence": 1,
      "tasks": [
        {"title": "验证 JWT 可行性", "type": "exploratory"},
        {"title": "实现 JWT 中间件", "type": "dev"},
        {"title": "添加 JWT 测试", "type": "dev"}
      ]
    }
  ]
}
```

---

### 2️⃣ Exploratory Agent（验证专家）

**职责**：
- hack 代码快速验证可行性
- 记录真实依赖和坑点
- 生成完整的 PRD/DOD

**工作流**：
1. 创建临时 worktree（隔离）
2. hack 代码（能跑就行，不要干净）
3. 手动测试或 curl 测试
4. 记录踩的坑（依赖、配置、API 限制）
5. 生成 PRD/DOD（基于跑通的代码）
6. 保存 PRD/DOD 到主仓库 develop
7. 删除 worktree（临时代码不进主线）

**产物**：
- `.prd-<name>.md`: 完整需求文档（10-20 行，包含真实依赖）
- `.dod-<name>.md`: 验收标准（测试清单，基于实际验证）

**不做**：
- ❌ 不创建 PR
- ❌ 不走 CI
- ❌ 不合并代码

---

### 3️⃣ Dev Agent（交付工程师）

**职责**：
- 读取 PRD/DOD
- 写干净、可维护的代码
- 完整测试覆盖
- 走 CI/PR 流程
- **循环直到 PR 合并**

**工作流**：
1. 读取 PRD/DOD（从 Exploratory 或 Brain）
2. 创建 cp-* 分支
3. 写干净代码（符合规范、错误处理、注释）
4. 写完整测试（单元 + 集成）
5. 创建 PR
6. 等待 CI
7. **如果 CI 失败 → 分析错误 → 修复 → 重新 push → 循环**
8. **如果合并冲突 → 拉取最新 → 解决冲突 → 重新 push → 循环**
9. PR 合并 → 回调 Brain → **完成**

**循环保证**：
- Stop Hook 检测 .dev-mode 文件
- PR 未合并 → exit 2 → Claude 继续执行
- PR 已合并 → exit 0 → Claude 结束

**产物**：
- 功能代码（已合并到 develop）
- 完整测试（通过 CI）
- PR 记录（可追溯）

---

## 文件传递机制

### Exploratory → Dev 的 PRD/DOD 传递

```
Exploratory (worktree):
    hack 代码 → 生成 PRD/DOD
        ↓
    复制到主仓库
        ↓
    commit + push 到 develop
        ↓
    .prd-jwt-auth.md (在 develop 分支)
    .dod-jwt-auth.md (在 develop 分支)

Dev (主仓库):
    git checkout develop
    git pull
        ↓
    读取 .prd-jwt-auth.md ← 找到了！
        ↓
    创建 cp-* 分支
        ↓
    写代码 → PR → 合并
```

**关键**：
- Exploratory 的 PRD/DOD 提交到 develop 分支
- Dev 从 develop 分支读取
- 同一个 PR Plan 的 Tasks 共享同一个 PRD/DOD

**文件命名规则**：
- 基于 PR Plan title 生成文件名
- 例如：PR Plan "实现 JWT 认证" → `.prd-jwt-auth.md`
- 同一个 PR Plan 的所有 Dev Tasks 使用同一个 PRD/DOD

---

## 多 Initiative 并行

### 场景：3 个 Initiatives 同时在跑

```
Initiative A (P0): "用户认证系统"
    PR Plan A1 (sequence=1): Task A1.1 (exploratory), A1.2 (dev)
    PR Plan A2 (sequence=2, depends_on=[A1]): Task A2.1 (exploratory), A2.2 (dev)

Initiative B (P1): "数据分析模块"
    PR Plan B1 (sequence=1): Task B1.1 (exploratory), B1.2 (dev)

Initiative C (P2): "通知系统"
    PR Plan C1 (sequence=1): Task C1.1 (exploratory), C1.2 (dev)
```

### Brain Tick Loop 的派发策略

```javascript
// planner.js: planNextTask()
// 遍历所有 Initiatives（按 created_at 排序）
for (const initiative of initiativesResult.rows) {
  const nextPrPlan = await getNextPrPlan(initiative.id);
  if (nextPrPlan) {
    // 找到第一个可执行的 PR Plan
    // 查询这个 PR Plan 的 queued tasks
    return task;  // 返回第一个 Task
  }
}
```

**执行顺序**（按 Initiative created_at）：

```
Tick 1: Initiative A (最早创建)
    → PR Plan A1 → Task A1.1 (exploratory)

Tick 2: Initiative A
    → PR Plan A1 → Task A1.2 (dev) ← 同一个 PR Plan 连续执行

Tick 3: Initiative A
    → PR Plan A2 被 depends_on 阻塞
    → 跳到 Initiative B
    → PR Plan B1 → Task B1.1 (exploratory)

Tick 4: Initiative B
    → PR Plan B1 → Task B1.2 (dev)

Tick 5: Initiative C
    → PR Plan C1 → Task C1.1 (exploratory)

Tick 6: Initiative C
    → PR Plan C1 → Task C1.2 (dev)

Tick 7: Initiative A
    → PR Plan A2 的 depends_on 满足了（A1 完成）
    → Task A2.1 (exploratory)
```

**关键特性**：
1. ✅ 同一个 PR Plan 的 Tasks 连续执行（不会割裂）
2. ✅ PR Plan 的 depends_on 得到尊重
3. ✅ Initiatives 按 created_at 轮转（公平）
4. ✅ Sequential execution = 1 task at a time（安全）

---

## 完整示例

### 输入：KR

```
KR: "完成用户认证系统，支持 JWT 和 OAuth，覆盖率 > 80%"
```

### Step 1: 秋米 /okr 拆解

```json
{
  "kr_id": "kr-auth-001",
  "initiative": {
    "title": "实现用户认证系统",
    "description": "Why: 支持多租户安全登录\nWhat: JWT 认证 + OAuth 第三方登录\nOutcome: 用户能安全登录，覆盖率 > 80%",
    "repository": "cecelia-core"
  },
  "pr_plans": [
    {
      "title": "实现 JWT 认证",
      "description": "实现 JWT token 生成、验证、刷新机制",
      "sequence": 1,
      "depends_on": [],
      "tasks": [
        {
          "title": "验证 JWT 可行性",
          "type": "exploratory",
          "description": "测试 jsonwebtoken 库，验证 token 生成和验证流程"
        },
        {
          "title": "实现 JWT 中间件",
          "type": "dev",
          "description": "编写 JWT 认证中间件，支持 token 验证和刷新"
        },
        {
          "title": "添加 JWT 测试",
          "type": "dev",
          "description": "单元测试 + 集成测试，覆盖率 > 80%"
        }
      ]
    },
    {
      "title": "实现 OAuth 集成",
      "description": "集成 GitHub OAuth 第三方登录",
      "sequence": 2,
      "depends_on": [1],
      "tasks": [
        {
          "title": "验证 OAuth 流程",
          "type": "exploratory",
          "description": "测试 GitHub OAuth 授权流程，验证回调处理"
        },
        {
          "title": "实现 OAuth 登录",
          "type": "dev",
          "description": "实现 OAuth 授权和回调处理"
        }
      ]
    }
  ]
}
```

**存储到 Brain**：
```sql
-- projects 表
INSERT INTO projects (id, name, description, repo_path, status)
VALUES ('init-123', '实现用户认证系统', 'Why: ...', '/home/xx/perfect21/cecelia/core', 'active');

-- pr_plans 表
INSERT INTO pr_plans (id, project_id, title, sequence, depends_on, status)
VALUES
  ('pp-1', 'init-123', '实现 JWT 认证', 1, '[]', 'planning'),
  ('pp-2', 'init-123', '实现 OAuth 集成', 2, '["pp-1"]', 'planning');

-- tasks 表
INSERT INTO tasks (id, pr_plan_id, title, type, description, status)
VALUES
  ('task-1.1', 'pp-1', '验证 JWT 可行性', 'exploratory', '测试 jsonwebtoken...', 'queued'),
  ('task-1.2', 'pp-1', '实现 JWT 中间件', 'dev', '编写 JWT 认证中间件...', 'queued'),
  ('task-1.3', 'pp-1', '添加 JWT 测试', 'dev', '单元测试 + 集成测试...', 'queued'),
  ('task-2.1', 'pp-2', '验证 OAuth 流程', 'exploratory', '测试 GitHub OAuth...', 'queued'),
  ('task-2.2', 'pp-2', '实现 OAuth 登录', 'dev', '实现 OAuth 授权...', 'queued');
```

---

### Step 2: Brain Tick Loop 执行

#### Tick 1-3: PR Plan 1 执行

```
[Tick 1 - T+0min]
planNextTask() → Task 1.1 (exploratory)
dispatchTask() → Exploratory Agent

Exploratory Agent:
  1. 创建 worktree: ../exploratory-jwt-1234
  2. npm install jsonwebtoken
  3. 写 hack 代码测试 JWT:
     ```javascript
     const jwt = require('jsonwebtoken');
     const secret = 'test-secret';
     const token = jwt.sign({ userId: 123 }, secret, { expiresIn: '24h' });
     const decoded = jwt.verify(token, secret);
     console.log('✅ JWT works:', decoded);
     ```
  4. 记录踩坑:
     - 需要 JWT_SECRET 环境变量
     - Token 过期时间设置为 24h
     - 需要 refresh token 机制（后续实现）
  5. 生成 PRD/DOD:
     .prd-jwt-auth.md:
       ```
       # JWT 认证中间件 PRD

       ## Why
       需要安全的用户认证机制，防止未授权访问

       ## What
       - 使用 jsonwebtoken 库
       - 支持 token 生成、验证、刷新
       - Token 有效期 24h

       ## How
       1. 安装依赖：npm install jsonwebtoken
       2. 创建 middleware/jwt.js
       3. 实现 generateToken(userId)
       4. 实现 verifyToken(token)
       5. 添加 JWT_SECRET 环境变量

       ## Dependencies
       - jsonwebtoken: ^9.0.0
       - 环境变量: JWT_SECRET
       ```

     .dod-jwt-auth.md:
       ```
       # JWT 认证中间件 DoD

       ## 验收标准
       - [ ] generateToken() 能生成有效 token
       - [ ] verifyToken() 能验证 token
       - [ ] Token 包含 userId
       - [ ] Token 过期后验证失败
       - [ ] 单元测试覆盖率 > 80%
       - [ ] 集成测试通过
       ```

  6. 保存到主仓库:
     cp .prd-jwt-auth.md /home/xx/perfect21/cecelia/core/
     cp .dod-jwt-auth.md /home/xx/perfect21/cecelia/core/
     cd /home/xx/perfect21/cecelia/core
     git add .prd-jwt-auth.md .dod-jwt-auth.md
     git commit -m "docs: add JWT auth PRD/DOD from exploratory"
     git push origin develop

  7. 清理 worktree:
     git worktree remove ../exploratory-jwt-1234 --force

  8. 回调 Brain:
     curl -X POST localhost:5221/api/brain/execution-callback \
       -d '{"task_id":"task-1.1","status":"completed"}'

Task 1.1: queued → in_progress → completed ✅
时间: 15 分钟

---

[Tick 2 - T+15min]
planNextTask() → Task 1.2 (dev)  ← 同一个 PR Plan
dispatchTask() → Dev Agent

Dev Agent:
  1. 读取 PRD/DOD:
     git checkout develop
     git pull
     cat .prd-jwt-auth.md  # ← 找到了！
     cat .dod-jwt-auth.md

  2. 创建分支:
     git checkout -b cp-implement-jwt-middleware

  3. 写干净代码:
     brain/src/middleware/jwt.js:
       ```javascript
       import jwt from 'jsonwebtoken';

       const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';
       const TOKEN_EXPIRY = '24h';

       export function generateToken(userId) {
         if (!userId) throw new Error('userId is required');
         return jwt.sign({ userId }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
       }

       export function verifyToken(token) {
         if (!token) throw new Error('token is required');
         try {
           return jwt.verify(token, JWT_SECRET);
         } catch (err) {
           throw new Error('Invalid or expired token');
         }
       }

       export function authMiddleware(req, res, next) {
         const token = req.headers.authorization?.replace('Bearer ', '');
         if (!token) return res.status(401).json({ error: 'No token provided' });

         try {
           req.user = verifyToken(token);
           next();
         } catch (err) {
           res.status(401).json({ error: err.message });
         }
       }
       ```

     brain/src/middleware/__tests__/jwt.test.js:
       ```javascript
       import { generateToken, verifyToken, authMiddleware } from '../jwt.js';

       describe('JWT Middleware', () => {
         test('generateToken creates valid token', () => {
           const token = generateToken(123);
           expect(token).toBeDefined();
           const decoded = verifyToken(token);
           expect(decoded.userId).toBe(123);
         });

         test('verifyToken rejects invalid token', () => {
           expect(() => verifyToken('invalid')).toThrow('Invalid or expired token');
         });

         test('authMiddleware sets req.user', async () => {
           const token = generateToken(123);
           const req = { headers: { authorization: `Bearer ${token}` } };
           const res = {};
           const next = jest.fn();

           authMiddleware(req, res, next);
           expect(req.user.userId).toBe(123);
           expect(next).toHaveBeenCalled();
         });

         // ... 更多测试，覆盖率 > 80%
       });
       ```

  4. 本地测试:
     npm test
     # ✅ All tests passed, coverage: 85%

  5. 创建 PR:
     git add .
     git commit -m "feat: implement JWT middleware

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
     git push origin cp-implement-jwt-middleware
     gh pr create --title "feat: implement JWT middleware" \
       --body "Implements JWT authentication middleware as per .prd-jwt-auth.md" \
       --base develop

  6. 等待 CI:
     # GitHub Actions 运行中...
     # Version Check ✅
     # Facts Consistency ✅
     # Brain (Node.js) ✅
     # Tests: 85% coverage ✅
     # All checks passed ✅

  7. 合并 PR:
     gh pr merge --squash --delete-branch

  8. 回调 Brain:
     curl -X POST localhost:5221/api/brain/execution-callback \
       -d '{"task_id":"task-1.2","status":"completed"}'

Task 1.2: queued → in_progress → completed ✅
时间: 30 分钟

---

[Tick 3 - T+45min]
planNextTask() → Task 1.3 (dev)  ← 同一个 PR Plan
dispatchTask() → Dev Agent

Dev Agent:
  （类似 Task 1.2，添加更多测试）

Task 1.3: completed ✅
时间: 20 分钟

---

checkPrPlansCompletion():
  PR Plan 1 所有 Tasks 完成
  → updatePrPlanStatus('pp-1', 'completed')

PR Plan 1: planning → in_progress → completed ✅
```

#### Tick 4-5: PR Plan 2 执行

```
[Tick 4 - T+65min]
planNextTask() → PR Plan 2 (depends_on=[pp-1] 已满足)
  → Task 2.1 (exploratory)
dispatchTask() → Exploratory Agent

Exploratory Agent:
  （验证 GitHub OAuth 流程）
  → 生成 .prd-oauth.md, .dod-oauth.md

Task 2.1: completed ✅

---

[Tick 5 - T+85min]
planNextTask() → Task 2.2 (dev)
dispatchTask() → Dev Agent

Dev Agent:
  读取 .prd-oauth.md
  → 实现 OAuth 登录
  → PR 合并

Task 2.2: completed ✅

---

checkPrPlansCompletion():
  PR Plan 2 所有 Tasks 完成
  → updatePrPlanStatus('pp-2', 'completed')

PR Plan 2: completed ✅
```

#### 总结

```
总耗时: ~110 分钟
总 Tasks: 5 个
  - 2 个 exploratory (Task 1.1, 2.1)
  - 3 个 dev (Task 1.2, 1.3, 2.2)

总 PRs: 3 个
  - PR #1: JWT middleware
  - PR #2: JWT tests
  - PR #3: OAuth integration

最终产物:
  - JWT 认证系统（已合并到 develop）
  - OAuth 第三方登录（已合并到 develop）
  - 测试覆盖率 > 80%
  - KR 完成 ✅
```

---

## 🎯 完美闭环的关键

### 1. 职责清晰

| 角色 | 做什么 | 不做什么 |
|------|--------|----------|
| 秋米 /okr | 拆解规划 | ❌ 不写代码、不验证 |
| Exploratory | 验证可行性、生成 PRD/DoD | ❌ 不走 CI、不合并代码 |
| Dev | 写代码、CI、PR、合并 | ❌ 不验证可行性 |

### 2. 文件传递

- Exploratory 的 PRD/DoD 提交到 develop 分支
- Dev 从 develop 分支读取
- 同一个 PR Plan 共享 PRD/DoD

### 3. 顺序保证

- PR Plan 的 sequence 和 depends_on 保证顺序
- planNextTask 按 pr_plan_id 查询，同一个 PR Plan 的 Tasks 连续执行
- Sequential execution = 1 task at a time，无竞争

### 4. 循环保证

- Stop Hook 检测 PR 是否合并
- PR 未合并 → exit 2 → 继续执行
- PR 已合并 → exit 0 → 完成

### 5. 错误处理

- Dev 自动修复所有问题（CI 失败、合并冲突、测试失败）
- 循环直到 PR 合并

---

## 🚀 这就是完美的闭环！

```
KR (目标)
  ↓
秋米 /okr (规划) → Initiative + PR Plans + Tasks
  ↓
Brain Tick Loop (派发) → 按顺序派发 Tasks
  ↓
Exploratory (验证) → hack 代码 → 生成 PRD/DoD
  ↓
Dev (交付) → 读取 PRD/DoD → 写代码 → CI → PR → 合并
  ↓
回调 Brain → Task 完成 → PR Plan 完成 → Initiative 完成
  ↓
KR 完成 ✅
```

**无缝衔接，自动化执行，24/7 无人值守！** 🎉
