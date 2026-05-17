---
id: playwright
version: 1.1.0
type: codex-skill
task_type: crystallize_forge
runner: packages/engine/runners/codex/playwright-runner.sh
created: 2026-03-16
updated: 2026-03-24
---

# /playwright — Playwright 自动化探索 Skill

> 给 Codex 用的 skill。Codex 在西安 M4 上通过 CDP 远程控制西安 PC 的浏览器，
> 用大模型探索并写出能跑通的 Playwright .cjs 脚本，保存后供后续直接执行。
>
> 本 skill 是 crystallize 流水线的 **Forge 阶段**（第2步）执行工具。

---

## 触发方式

Brain 创建 `task_type: crystallize_forge` 任务后，`playwright-runner.sh` 自动调用。

```bash
bash packages/engine/runners/codex/playwright-runner.sh --task-id <id>
```

---

## 所属流水线

| 阶段 | task_type | 描述 |
|------|-----------|------|
| 1 Scope | crystallize_scope | 定义目标 + DoD + 验收标准 |
| **2 Forge** | **crystallize_forge** | **Codex 探索写 Playwright 脚本** ← 本 skill |
| 3 Verify | crystallize_verify | 无 LLM 验证脚本（3次） |
| 4 Register | crystallize_register | 注册到 SKILL.md + 部署 |

---

## 环境信息

| 项目 | 值 |
|------|----|
| 执行机器 | 西安 M4 Mac mini |
| 目标 PC CDP | `http://100.97.242.124:19225` |
| Node.js | `/opt/homebrew/bin/node` |
| 脚本格式 | CommonJS (`.cjs`) |
| 脚本保存目录 | `~/playwright-scripts/` |

---

## 两阶段工作流

### Phase 1：探索（Forge）

Codex 用大模型反复尝试，直到 Playwright 脚本能稳定跑通：

```
检查环境（playwright 是否安装）
  ↓
写最简探索脚本（connectOverCDP → 截图）
  ↓
逐步添加目标操作
  ↓
node <script>.cjs 测试
  ↓
报错 → 分析 → 修改 → 再测试
  ↓
稳定通过 → 保存到 ~/playwright-scripts/<task_id>.cjs
```

### Phase 2：执行（Verify）

脚本保存后，Verify 阶段直接执行3次验证：

```bash
node ~/playwright-scripts/<task_id>.cjs
```

不再消耗 LLM token。

---

## Playwright 连接模板（必须用 connectOverCDP）

```javascript
'use strict';
const { chromium } = require('playwright');

async function main() {
  // 连接西安 PC 的 Chrome（已开启 remote debugging）
  const browser = await chromium.connectOverCDP('http://100.97.242.124:19225');
  const context = browser.contexts()[0] || await browser.newContext();
  const page = context.pages()[0] || await context.newPage();

  // ---- 你的操作 ----
  // await page.goto('https://...');
  // await page.waitForSelector('#element');
  // await page.click('#button');
  // -----------------

  await browser.close();
}

main().catch(console.error);
```

---

## 脚本规范

- 文件名：`~/playwright-scripts/<task_id>.cjs`
- 必须 `'use strict';`
- 头部注释包含：任务ID、功能描述、CDP地址、保存时间
- 用 `waitForSelector` 等待元素，不用固定 `sleep`
- 绝不硬编码账号密码（用环境变量）
- 脚本必须幂等（多次执行结果一致）

---

## 常见问题排查

| 问题 | 处理方法 |
|------|----------|
| `playwright` 未安装 | `npm install -g playwright` |
| CDP 连接超时 | 检查 PC 是否开启 Chrome remote debug |
| 元素找不到 | 先截图 `page.screenshot()` 看当前状态 |
| 登录页面跳转 | PC 的 Chrome 里手动先登录，脚本复用 session |
| 操作被反自动化拦截 | 增加 `page.waitForTimeout(1000)` 模拟人工延迟 |

---

## 相关文件

- Runner: `packages/engine/runners/codex/playwright-runner.sh`
- Brain 路由: `packages/brain/src/task-router.js`（`crystallize → xian`）
- 编排器: `packages/brain/src/crystallize-orchestrator.js`
- 参考脚本: `packages/workflows/skills/xiaohongshu-publisher/scripts/publish-xiaohongshu-image.cjs`
