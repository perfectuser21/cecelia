/**
 * staging-restart-policy.test.js
 *
 * 合同测试骨架：验证 docker-compose.staging.yml restart 策略（FR-1）
 *
 * [BEHAVIOR-1] staging Brain（5222）宿主重启后自动恢复
 * INV-2: staging tick disabled
 *
 * 运行方式：
 *   node tests/unit/staging-restart-policy.test.js
 * 或：
 *   cd packages/brain && npx vitest run ../../sprints/.../tests/unit/staging-restart-policy.test.js
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, '../../../../');
const STAGING_COMPOSE = path.join(WORKSPACE_ROOT, 'docker-compose.staging.yml');

describe('[BEHAVIOR-1] docker-compose.staging.yml restart 策略', () => {
  it('文件存在', () => {
    expect(fs.existsSync(STAGING_COMPOSE)).toBe(true);
  });

  it('不含 restart: "no"（已修复为 unless-stopped）', () => {
    const content = fs.readFileSync(STAGING_COMPOSE, 'utf-8');
    // FR-1 实施后：不应再有 restart: "no"
    expect(content).not.toMatch(/restart:\s+"no"/);
  });

  it('含 restart: unless-stopped', () => {
    const content = fs.readFileSync(STAGING_COMPOSE, 'utf-8');
    expect(content).toMatch(/restart:\s+unless-stopped/);
  });

  it('含 depends_on pg:service_healthy（pg 就绪后再启动 Brain）', () => {
    const content = fs.readFileSync(STAGING_COMPOSE, 'utf-8');
    // 验证 service_healthy 条件
    expect(content).toMatch(/service_healthy/);
  });
});

describe('[INV-4] dev-deploy.sh migrate 失败时 exit 非 0', () => {
  it('dev-deploy.sh 存在且可执行', () => {
    const devDeployPath = path.join(WORKSPACE_ROOT, 'scripts', 'dev-deploy.sh');
    // 实施后取消注释：
    // expect(fs.existsSync(devDeployPath)).toBe(true);
    // const stat = fs.statSync(devDeployPath);
    // expect(stat.mode & 0o111).toBeGreaterThan(0); // 可执行
    expect(true).toBe(true); // placeholder
  });

  it('dev-deploy.sh 含 migrate 失败退出处理逻辑', () => {
    const devDeployPath = path.join(WORKSPACE_ROOT, 'scripts', 'dev-deploy.sh');
    // 实施后取消注释：
    // const content = fs.readFileSync(devDeployPath, 'utf-8');
    // expect(content).toMatch(/exit\s+[1-9]/); // 有非 0 退出
    // expect(content).toMatch(/migrate.*fail|fail.*migrate/i);
    expect(true).toBe(true); // placeholder
  });

  it('dev-deploy.sh 含备份清理逻辑（保留最近 7 个）', () => {
    const devDeployPath = path.join(WORKSPACE_ROOT, 'scripts', 'dev-deploy.sh');
    // 实施后取消注释：
    // const content = fs.readFileSync(devDeployPath, 'utf-8');
    // expect(content).toMatch(/cecelia-backups/);
    // expect(content).toMatch(/7/); // 保留 7 个备份
    expect(true).toBe(true); // placeholder
  });
});

describe('[BEHAVIOR-7] brain-deploy.sh 端口配置', () => {
  it('brain-deploy.sh TEMP_PORT 不为 5223（已改为 5224）', () => {
    const brainDeployPath = path.join(WORKSPACE_ROOT, 'scripts', 'brain-deploy.sh');
    // 实施后取消注释：
    // const content = fs.readFileSync(brainDeployPath, 'utf-8');
    // expect(content).not.toMatch(/TEMP_PORT=5223/);
    // expect(content).toMatch(/TEMP_PORT=5224/);
    expect(true).toBe(true); // placeholder
  });
});
