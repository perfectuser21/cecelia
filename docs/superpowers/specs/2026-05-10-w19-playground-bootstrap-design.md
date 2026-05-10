# Design: W19 Playground Bootstrap

**日期**: 2026-05-10
**分支**: cp-0510164812-w19-playground-bootstrap
**上游 PRD**: `docs/handoffs/2026-05-10-w19-walking-skeleton-playground-handoff-prd.md` §3
**范围**: 仅 bootstrap（不含 /sum endpoint，那是 W19 task 的产出物）

---

## 1. 目的

为 W19 Walking Skeleton harness pipeline 提供一个最薄的"被加工对象"——独立 Express + vitest 子项目 `cecelia/playground/`，与 Brain runtime 完全解耦。后续 W19 task 在 harness 容器里 push PR 给 playground 加 endpoint，evaluator 容器自起 server 真验证。

不解决"业务问题"，解决"harness 协议层有没有真跑通"。

## 2. 架构

```
cecelia/                          (monorepo root)
└── playground/                   (独立子项目，不被 brain 依赖)
    ├── package.json              (express + vitest + supertest)
    ├── server.js                 (Express app，GET /health → {ok:true})
    ├── tests/server.test.js      (vitest + supertest，1 test)
    └── README.md                 (用途 + W19 上下文)
```

**关键决策**：
- **新顶级目录**（非 `apps/playground/` 或 `packages/playground/`）—— monorepo workspace 不收编它，brain CI 不感知它，避免污染主仓库依赖图
- **ESM** (`"type": "module"`) —— 与 brain 保持一致，避免 W19 generator 写代码时混用 require/import
- **NODE_ENV=test 短路 listen** —— 测试用 supertest 直 request app 实例，不真起端口（避免端口冲突）
- **PORT=3000 默认** —— 与 brain :5221 / dashboard :5211 不冲突；W19 evaluator 自起 :3000 也走默认

## 3. 组件

### 3.1 `playground/package.json`
- Dependencies: `express ^4.21.0`
- DevDependencies: `supertest ^7.0.0`, `vitest ^4.1.5`
- Scripts: `start` (node server.js), `test` (vitest run)
- name: `cecelia-playground`，version `0.1.0`，type `module`

### 3.2 `playground/server.js`
- 默认 export Express app（让 supertest 可 import）
- GET /health 返 `{ok: true}`
- listen 走 `process.env.PLAYGROUND_PORT || 3000`
- NODE_ENV=test 时跳过 listen（避免单测时占端口）

### 3.3 `playground/tests/server.test.js`
- vitest + supertest
- 1 测试用例：`GET /health → 200 + {ok:true}`

### 3.4 `playground/README.md`
- 1-2 段文字：用途（W19 walking skeleton 测试床）+ 启动方式 + 与 cecelia core 的解耦原则

## 4. 数据流

```
开发者本地：
  cd playground && npm install && npm test  ← 1/1 PASS

W19 evaluator container（PRD §2 架构，本 bootstrap 不实现）：
  pull main 含 generator merged 的 /sum endpoint
  cd playground && npm install
  PLAYGROUND_PORT=3000 node server.js &
  sleep 2 && curl localhost:3000/sum?a=2&b=3
  → expect {result: 5}
```

## 5. 错误处理

- bootstrap 不引入复杂错误处理（GET /health 永远 200）—— W19 task 加 /sum 时由 generator 自己处理 query 校验
- npm install 失败由本地 verify 拦截（不能 push 没 install 通的代码）

## 6. 测试策略

- **Unit (vitest + supertest)**: `playground/tests/server.test.js` 直 request app 实例验 `/health`
- **Integration**: 不需要——bootstrap 单组件
- **E2E**: 不需要——W19 task 的 evaluator container 才是端到端验证场景，本 PR 只搭骨架
- **smoke.sh**: 不需要——v18.7.0 规则只适用 `packages/brain/src/` runtime；playground 完全独立子项目

## 7. CI 影响评估

- L1 (lint/format) - L4 (e2e) 现有 jobs 不扫描 `playground/`（确认 .eslintrc / vitest.config 不含此路径）
- 新增 4 文件不触发 brain-ci.yml / engine-ci.yml / workspace-ci.yml
- DoD lint job (`check-dod-mapping.cjs`) 走 `manual:node` 命令，CI 兼容

## 8. 严禁（来自上游 PRD §10）

- 不动 `packages/brain/src/`、`apps/`、`packages/engine/`
- 不在 bootstrap 加 `/sum` endpoint（让 W19 task 加，否则失去 walking skeleton 测试目的）
- 不 pin 任何 cecelia 内部 version
- 不在 DoD 写 `curl localhost:5221`

## 9. DoD（4 条）

- [ ] [ARTIFACT] `playground/package.json` 存在且含 express + vitest 依赖
  Test: `manual:node -e "const p=require('./playground/package.json');if(!p.dependencies.express||!p.devDependencies.vitest)process.exit(1)"`
- [ ] [ARTIFACT] `playground/server.js` 含 `/health` 路由
  Test: `manual:node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!c.includes('/health'))process.exit(1)"`
- [ ] [BEHAVIOR] vitest 在 playground 内 1/1 PASS
  Test: `playground/tests/server.test.js`
- [ ] [BEHAVIOR] NODE_ENV=test import server.js 不抛错（不真 listen）
  Test: `manual:node -e "process.env.NODE_ENV='test';import('./playground/server.js').then(()=>process.exit(0)).catch(()=>process.exit(1))"`

## 10. 成功标准

- [ ] 4 文件就位
- [ ] `cd playground && npm install` 干净
- [ ] `npm test` 1/1 PASS
- [ ] PR push + CI 全绿（无 admin merge）
- [ ] PR merged 到 main
- [ ] `git show origin/main:playground/server.js` 含 `/health`

## 11. 不做

- 不加 /sum endpoint（W19 task 任务，本 PR 加了就破坏 walking skeleton 测试目的）
- 不写 README 之外的文档
- 不引入 prettier / eslint / TypeScript（playground 极简原则）
- 不为 W20+ 留扩展接口（YAGNI）
- 不动 cecelia 任何其他文件
