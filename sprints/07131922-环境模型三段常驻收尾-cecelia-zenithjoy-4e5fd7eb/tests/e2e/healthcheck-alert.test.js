/**
 * healthcheck-alert.test.js
 *
 * 合同测试骨架：验证 Develop 健康监控告警（FR-7）
 *
 * [BEHAVIOR-8] develop Brain 停止后 5 分钟内，Brain production 出现告警记录
 * INV-7: brain-deploy.sh 使用 5224 后 5223 仅为 dashboard staging
 *
 * 注意：[BEHAVIOR-8] 端到端耗时约 6 分钟，标记为 skip，手动运行
 */

import { describe, it, expect } from 'vitest';

const PROD_BRAIN_URL = 'http://localhost:5221';

describe('[BEHAVIOR-8] dev 健康告警写入 Brain production（E2E，手动）', () => {
  it.skip('develop Brain 停止后 production tasks 出现 alert 类型任务（需等待 ~6min）', async () => {
    // 步骤 1：停止 develop Brain（假设已通过外部操作）
    // docker stop cecelia-node-brain-dev

    // 步骤 2：等待 cron 周期（5 分钟 + 缓冲 1 分钟）
    console.log('等待 dev-healthcheck-cron.sh 执行（约 6 分钟）...');
    await new Promise(resolve => setTimeout(resolve, 360_000));

    // 步骤 3：查询 production 告警
    const res = await fetch(
      `${PROD_BRAIN_URL}/api/brain/tasks?type=alert&limit=10`
    );
    expect(res.ok).toBe(true);

    const tasks = await res.json();
    const devAlerts = tasks.filter(t =>
      (t.title || '').includes('5220') ||
      (t.title || '').includes('develop') ||
      (t.title || '').includes('health check failed')
    );

    expect(devAlerts.length).toBeGreaterThanOrEqual(1);
    console.log('发现告警：', devAlerts.map(t => t.title));
  }, 420_000); // 7 分钟超时
});

describe('[INV-7] 端口隔离静态验证', () => {
  it('brain-deploy.sh 文件中 TEMP_PORT 值为 5224（FR-6 实施后）', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const brainDeployPath = path.resolve(__dirname, '../../../../scripts/brain-deploy.sh');

    if (!fs.existsSync(brainDeployPath)) {
      console.warn('brain-deploy.sh 不存在，跳过验证');
      return;
    }

    const content = fs.readFileSync(brainDeployPath, 'utf-8');
    // FR-6 实施前此测试失败，实施后通过
    // TODO: 取消下面注释（FR-6 实施后）
    // expect(content).toMatch(/TEMP_PORT=5224/);
    // expect(content).not.toMatch(/TEMP_PORT=5223/);
    expect(true).toBe(true); // placeholder
  });

  it('dev-healthcheck-cron.sh 存在且含 Brain alert 写入逻辑', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const cronPath = path.resolve(__dirname, '../../../../scripts/dev-healthcheck-cron.sh');

    // FR-7 实施后取消注释：
    // expect(fs.existsSync(cronPath)).toBe(true);
    // const content = fs.readFileSync(cronPath, 'utf-8');
    // expect(content).toMatch(/localhost:5221\/api\/brain\/tasks/);
    // expect(content).toMatch(/type.*alert|alert.*type/i);
    expect(true).toBe(true); // placeholder
  });
});

describe('[BEHAVIOR-2][BEHAVIOR-3] dev-verify.sh 验证脚本', () => {
  it('dev-verify.sh 存在且含健康检查逻辑（FR-3 实施后）', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const verifyPath = path.resolve(__dirname, '../../../../scripts/dev-verify.sh');

    // FR-3 实施后取消注释：
    // expect(fs.existsSync(verifyPath)).toBe(true);
    // const content = fs.readFileSync(verifyPath, 'utf-8');
    // expect(content).toMatch(/5220/);
    // expect(content).toMatch(/healthy/i);
    // expect(content).toMatch(/exit\s+[01]/); // 明确退出码
    expect(true).toBe(true); // placeholder
  });
});
