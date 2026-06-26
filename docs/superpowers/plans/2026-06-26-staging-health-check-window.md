# staging-deploy 健康检查窗口延长 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans 逐 task 实现。步骤用 checkbox 跟踪。

**Goal:** scripts/staging-deploy.sh 健康检查窗口 60s→180s（MAX_TRIES 12→36），不再因 staging brain 慢启动误判 deploy_failed。

**Architecture:** 改一个常量 + 同步文案；加一个 vitest 守卫解析脚本验证窗口 >= 180s。

**Tech Stack:** bash, vitest。

---

## File Structure
- `scripts/staging-deploy.sh` — MAX_TRIES 12→36，echo "最多 60s"→"最多 180s"
- `packages/brain/src/__tests__/staging-deploy-health-window.test.js` — 新建守卫单测

---

### Task 1: 延长健康检查窗口 + 守卫

**Files:**
- Create: `packages/brain/src/__tests__/staging-deploy-health-window.test.js`
- Modify: `scripts/staging-deploy.sh`（line 157 echo、line 159 MAX_TRIES）

- [ ] **Step 1: 写 failing test**

创建 `packages/brain/src/__tests__/staging-deploy-health-window.test.js`：
```javascript
/**
 * 守卫：staging-deploy.sh 健康检查窗口必须 >= 180s（MAX_TRIES × sleep）。
 * staging brain 启动 >60s，窗口退回 60s 会误判 deploy_failed 阻断 promote。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../../../scripts/staging-deploy.sh');

describe('staging-deploy.sh 健康检查窗口', () => {
  const src = readFileSync(SCRIPT, 'utf8');

  it('健康检查总窗口 >= 180s（MAX_TRIES × sleep）', () => {
    const maxTries = Number((src.match(/MAX_TRIES=(\d+)/) || [])[1]);
    // 健康检查循环里的 sleep 秒数（取循环体内第一个 sleep N）
    const sleepSec = Number((src.match(/while \[ \$TRIES -lt \$MAX_TRIES \][\s\S]{0,120}?sleep (\d+)/) || [])[1]);
    expect(maxTries).toBeGreaterThanOrEqual(36);
    expect(maxTries * sleepSec).toBeGreaterThanOrEqual(180);
  });
});
```

- [ ] **Step 2: 运行确认 RED**

Run: `cd /Users/administrator/worktrees/cecelia/staging-health-check-window/packages/brain && npx vitest run src/__tests__/staging-deploy-health-window.test.js`
Expected: FAIL — 当前 MAX_TRIES=12（< 36），12×5=60 < 180。

- [ ] **Step 3: 改 staging-deploy.sh**

`scripts/staging-deploy.sh` line 157：
```bash
echo "[5/6] 等待 staging 健康检查（最多 180s）..."
```
line 159：
```bash
MAX_TRIES=36
```

- [ ] **Step 4: 运行确认 GREEN**

Run: `cd /Users/administrator/worktrees/cecelia/staging-health-check-window/packages/brain && npx vitest run src/__tests__/staging-deploy-health-window.test.js`
Expected: PASS（1 passed，MAX_TRIES=36，36×5=180 >= 180）

- [ ] **Step 5: commit（test 先 impl 后）**

```bash
cd /Users/administrator/worktrees/cecelia/staging-health-check-window
git add packages/brain/src/__tests__/staging-deploy-health-window.test.js
git commit -m "test(brain): staging-deploy 健康检查窗口守卫(RED)"
git add scripts/staging-deploy.sh
git commit -m "fix(deploy): staging-deploy 健康检查窗口 60s→180s，避免 staging 慢启动误判"
```

---

### Task 2: DoD + DevGate

- [ ] **Step 1: 写 .dod.md**

`.dod.md`（worktree 根）：
```markdown
# DoD: staging-deploy 健康检查窗口延长

- [x] [ARTIFACT] MAX_TRIES=36（窗口 180s）
  Test: manual:node -e "const s=require('fs').readFileSync('scripts/staging-deploy.sh','utf8'); if(Number((s.match(/MAX_TRIES=(\\d+)/)||[])[1])<36)process.exit(1)"
- [x] [BEHAVIOR] 健康检查总窗口 >= 180s 守卫（brain-ci vitest 真跑）
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/staging-deploy-health-window.test.js')"
```

- [ ] **Step 2: DevGate**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/staging-health-check-window
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
```
Expected: 全过

- [ ] **Step 3: commit .dod.md**

```bash
cd /Users/administrator/worktrees/cecelia/staging-health-check-window
git add .dod.md && git commit -m "docs: DoD 验收映射（健康检查窗口）"
```
