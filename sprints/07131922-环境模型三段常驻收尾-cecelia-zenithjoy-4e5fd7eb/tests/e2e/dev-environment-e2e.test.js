/**
 * dev-environment-e2e.test.js
 *
 * E2E 验收测试骨架：验证 Cecelia develop 环境（5220）完整运行状态
 *
 * [BEHAVIOR-2] dev-deploy.sh 执行后 develop Brain 健康检查通过
 * [BEHAVIOR-3] cecelia_dev DB migrate 完成且版本一致
 * [BEHAVIOR-4] dev-deploy.sh 幂等性（重复执行不报错）
 * [BEHAVIOR-6] production 5221 全程不中断（INV-1）
 *
 * 前置条件：
 *   - FR-2（dev-deploy.sh）已实施
 *   - FR-3（dev-verify.sh）已实施
 *   - Docker 可用，.env.docker 或 .env.dev 存在
 *
 * 运行方式（本地手动，非 CI 自动）：
 *   cd /workspace && node sprints/.../tests/e2e/dev-environment-e2e.test.js
 *
 * 注意：本测试依赖真实运行环境，CI 中标记为 skip，仅手动验收时运行
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';

const DEV_BRAIN_URL = 'http://localhost:5220';
const PROD_BRAIN_URL = 'http://localhost:5221';
const STAGING_BRAIN_URL = 'http://localhost:5222';

/**
 * 工具函数：curl 健康检查
 */
async function checkHealth(url) {
  try {
    const res = await fetch(`${url}/api/brain/health`);
    if (!res.ok) return { ok: false, status: res.status };
    const body = await res.json();
    return { ok: true, status: res.status, body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * 工具函数：检查端点是否可达
 */
async function checkEndpoint(url) {
  try {
    const res = await fetch(url);
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// === E2E 测试套件（依赖真实环境，CI 中 skip）===

describe.skip('[BEHAVIOR-2] develop Brain 健康检查（E2E，需真实环境）', () => {
  it('localhost:5220/api/brain/health 返回 200 + status=healthy', async () => {
    const result = await checkHealth(DEV_BRAIN_URL);
    expect(result.ok).toBe(true);
    expect(result.body.status).toBe('healthy');
  });
});

describe.skip('[BEHAVIOR-3] cecelia_dev DB migrate 版本一致（E2E，需真实环境）', () => {
  it('/api/brain/tasks?limit=1 端点可访问（间接验证 DB 连接）', async () => {
    const result = await checkEndpoint(`${DEV_BRAIN_URL}/api/brain/tasks?limit=1`);
    expect(result.ok).toBe(true);
  });
});

describe.skip('[BEHAVIOR-6] production Brain 全程不中断（E2E，需真实环境）', () => {
  it('localhost:5221/api/brain/health 返回 200 + status=healthy', async () => {
    const result = await checkHealth(PROD_BRAIN_URL);
    expect(result.ok).toBe(true);
    expect(result.body.status).toBe('healthy');
  });

  it('production 不受 dev 部署影响（INV-1）', async () => {
    // 在 dev deploy 完成后验证 production 仍然健康
    const result = await checkHealth(PROD_BRAIN_URL);
    expect(result.ok).toBe(true);
    expect(result.body.status).toBe('healthy');
  });
});

describe.skip('[INV-3] develop Brain tick disabled（E2E，需真实环境）', () => {
  it('develop Brain health 响应中 tick_enabled 为 false', async () => {
    const result = await checkHealth(DEV_BRAIN_URL);
    expect(result.ok).toBe(true);
    // tick 应该 disabled
    const tickEnabled = result.body.tick_enabled;
    expect(tickEnabled === false || tickEnabled === null || tickEnabled === undefined).toBe(true);
  });
});

// === 可在 CI 中运行的静态验证（不依赖真实服务）===

describe('[静态验证] 合同文件完整性检查', () => {
  it('contract-draft.md 存在', async () => {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const { fileURLToPath } = await import('url');
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const contractPath = path.join(__dirname, '../../contract-draft.md');
      expect(fs.existsSync(contractPath)).toBe(true);
    } catch (e) {
      expect.fail(`contract-draft.md 不存在: ${e.message}`);
    }
  });

  it('contract-dod.md 存在', async () => {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const { fileURLToPath } = await import('url');
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const dodPath = path.join(__dirname, '../../contract-dod.md');
      expect(fs.existsSync(dodPath)).toBe(true);
    } catch (e) {
      expect.fail(`contract-dod.md 不存在: ${e.message}`);
    }
  });

  it('contract-draft.md 含 ≥4 个 [BEHAVIOR] 条目', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const contractPath = path.join(__dirname, '../../contract-draft.md');
    const content = fs.readFileSync(contractPath, 'utf-8');
    const behaviorCount = (content.match(/\[BEHAVIOR-\d+\]/g) || []).length;
    expect(behaviorCount).toBeGreaterThanOrEqual(4);
  });

  it('contract-dod.md 含 manual:bash 执行命令', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const dodPath = path.join(__dirname, '../../contract-dod.md');
    const content = fs.readFileSync(dodPath, 'utf-8');
    expect(content).toMatch(/manual:bash/);
  });

  it('contract-dod.md 含 ≥4 个 [BEHAVIOR] 条目', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const dodPath = path.join(__dirname, '../../contract-dod.md');
    const content = fs.readFileSync(dodPath, 'utf-8');
    const behaviorCount = (content.match(/\[BEHAVIOR-\d+\]/g) || []).length;
    expect(behaviorCount).toBeGreaterThanOrEqual(4);
  });
});
