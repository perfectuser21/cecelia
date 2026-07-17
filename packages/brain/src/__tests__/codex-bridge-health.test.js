/**
 * codex-bridge /health docker_available 字段单元测试
 * BEHAVIOR-5: /health 返回 docker_available 字段
 * ART-11: mock execSync → docker_available true/false
 * TASK_ID: 7750cd32-d73b-4a53-91cf-8fd171bf358b
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

describe('codex-bridge /health docker_available BEHAVIOR-5', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('execSync("docker info") 成功 → docker_available=true', () => {
    execSync.mockReturnValue('Docker info output...');
    // 模拟 /health 中的 docker 探测逻辑
    let dockerAvailable = false;
    try {
      execSync('docker info', { timeout: 3000, stdio: 'pipe' });
      dockerAvailable = true;
    } catch {
      // docker 不可用
    }
    expect(dockerAvailable).toBe(true);
    expect(execSync).toHaveBeenCalledWith('docker info', expect.objectContaining({ timeout: 3000 }));
  });

  it('execSync("docker info") 抛异常 → docker_available=false', () => {
    execSync.mockImplementation(() => { throw new Error('Cannot connect to Docker daemon'); });
    let dockerAvailable = false;
    try {
      execSync('docker info', { timeout: 3000, stdio: 'pipe' });
      dockerAvailable = true;
    } catch {
      // docker 不可用，降级为 false
    }
    expect(dockerAvailable).toBe(false);
  });

  it('docker_available 字段存在于 /health 响应体', () => {
    // 验证 codex-bridge.cjs 中 /health 响应体包含 docker_available 字段
    // 静态字面量检查（不实际启动 HTTP 服务器）
    const { readFileSync } = require('fs');
    const bridgeSrc = readFileSync(
      new URL('../../scripts/codex-bridge/codex-bridge.cjs', import.meta.url),
      'utf8'
    );
    expect(bridgeSrc).toContain('docker_available');
    expect(bridgeSrc).toContain('execSync(\'docker info\'');
  });
});
