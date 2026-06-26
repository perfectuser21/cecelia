# staging-deploy 健康检查改 docker inspect health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans 逐 task 实现。

**Goal:** staging-deploy.sh 健康检查用 `docker inspect $STAGING_CONTAINER health` 替代容器内不通的 `curl localhost:5222`，让 staging healthy 被正确识别 → verdict PASS → promote 闭环。

**Architecture:** 改健康检查循环判定方式（curl→docker inspect），保留 MAX_TRIES=36；加 vitest 守卫。

**Tech Stack:** bash, vitest。

---

## File Structure
- `scripts/staging-deploy.sh` — 健康检查循环（line 161-170）curl 判定 → docker inspect health
- `packages/brain/src/__tests__/staging-deploy-docker-health.test.js` — 新建守卫单测

---

### Task 1: 健康检查改 docker inspect health

**Files:**
- Create: `packages/brain/src/__tests__/staging-deploy-docker-health.test.js`
- Modify: `scripts/staging-deploy.sh`（line 157 echo、line 161-170 循环体）

- [ ] **Step 1: 写 failing test**

创建 `packages/brain/src/__tests__/staging-deploy-docker-health.test.js`：
```javascript
/**
 * 守卫：staging-deploy.sh 健康检查必须用 docker inspect 容器 health（容器自己的 healthcheck），
 * 不能用 curl localhost:5222——staging-e2e-runner 在生产 brain 容器内跑，容器内 localhost 不通 staging 容器。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../../../scripts/staging-deploy.sh');

describe('staging-deploy.sh 健康检查方式', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  // 只取健康检查段（[5/6] 到 staging 验证之间）
  const seg = (src.match(/\[5\/6\][\s\S]*?健康检查超时[\s\S]*?exit 1/) || [''])[0];

  it('健康检查用 docker inspect 容器 health', () => {
    expect(seg).toMatch(/docker inspect/);
    expect(seg).toMatch(/State\.Health/);
  });

  it('健康检查不再用 curl localhost 判定（容器内不通）', () => {
    expect(seg).not.toMatch(/curl[^\n]*localhost:\$\{STAGING_PORT\}[^\n]*tick\/status/);
  });
});
```

- [ ] **Step 2: 运行确认 RED**

Run: `cd /Users/administrator/worktrees/cecelia/staging-health-docker-inspect/packages/brain && npx vitest run src/__tests__/staging-deploy-docker-health.test.js`
Expected: FAIL — 当前健康检查段是 curl localhost，无 docker inspect。

- [ ] **Step 3: 改 staging-deploy.sh**

line 157：
```bash
echo "[5/6] 等待 staging 健康检查（docker health，最多 180s）..."
```
line 161-170 循环体（curl 判定 → docker inspect）：
```bash
while [ $TRIES -lt $MAX_TRIES ]; do
    sleep 5
    TRIES=$((TRIES + 1))
    HSTATUS=$(docker inspect "${STAGING_CONTAINER}" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo "missing")
    if [ "$HSTATUS" = "healthy" ]; then
        echo "  ✓ staging 容器 ${STAGING_CONTAINER} health=healthy"
        HEALTHY=true
        break
    fi
    if [ "$HSTATUS" = "unhealthy" ]; then
        echo "  ✗ staging 容器 health=unhealthy，提前判失败"
        break
    fi
    echo "  Attempt ${TRIES}/${MAX_TRIES} (health=${HSTATUS})..."
done
```

- [ ] **Step 4: 运行确认 GREEN**

Run: `cd /Users/administrator/worktrees/cecelia/staging-health-docker-inspect/packages/brain && npx vitest run src/__tests__/staging-deploy-docker-health.test.js`
Expected: PASS（2 passed）

- [ ] **Step 5: bash 语法冒烟**

Run: `bash -n /Users/administrator/worktrees/cecelia/staging-health-docker-inspect/scripts/staging-deploy.sh && echo SYNTAX_OK`
Expected: SYNTAX_OK（改了 shell 循环，确认语法）

- [ ] **Step 6: commit（test 先 impl 后）**

```bash
cd /Users/administrator/worktrees/cecelia/staging-health-docker-inspect
git add packages/brain/src/__tests__/staging-deploy-docker-health.test.js
git commit -m "test(brain): staging-deploy 健康检查 docker inspect 守卫(RED)"
git add scripts/staging-deploy.sh
git commit -m "fix(deploy): staging-deploy 健康检查改 docker inspect health（修容器内 localhost 不通）"
```

---

### Task 2: DoD + DevGate + 回归

- [ ] **Step 1: 写 .dod.md**

`.dod.md`（worktree 根，覆盖）：
```markdown
# DoD: staging-deploy 健康检查改 docker inspect health

- [x] [ARTIFACT] 健康检查用 docker inspect State.Health
  Test: manual:node -e "const s=require('fs').readFileSync('scripts/staging-deploy.sh','utf8'); if(!s.includes('docker inspect')||!s.includes('State.Health'))process.exit(1)"
- [x] [BEHAVIOR] 健康检查用 docker health、不用 curl localhost 判定（brain-ci vitest 真跑）
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/staging-deploy-docker-health.test.js')"
```

- [ ] **Step 2: DevGate + #3434 窗口守卫无回归**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/staging-health-docker-inspect
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
cd packages/brain && npx vitest run src/__tests__/staging-deploy-health-window.test.js src/__tests__/staging-deploy-docker-health.test.js
```
Expected: 全过（#3434 窗口守卫 MAX_TRIES×5>=180 仍满足，MAX_TRIES=36 未动）

- [ ] **Step 3: commit .dod.md**

```bash
cd /Users/administrator/worktrees/cecelia/staging-health-docker-inspect
git add .dod.md && git commit -m "docs: DoD 验收映射（docker health 健康检查）"
```
