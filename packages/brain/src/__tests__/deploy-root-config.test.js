/**
 * deploy-root-config.test.js
 * 守住 CD 部署根配置：REPO_ROOT 必须指向专用部署仓（不是活人主仓）、
 * compose 项目名固定 cecelia（防换目录跑 compose 容器名冲突）、AUTORESET 开启、挂载存在。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const COMPOSE = readFileSync(
  new URL('../../../../docker-compose.yml', import.meta.url), 'utf8'
);

describe('deploy-root-config', () => {
  it('compose 顶层项目名固定 cecelia', () => {
    expect(COMPOSE).toMatch(/^name: cecelia$/m);
  });
  it('REPO_ROOT 指向专用部署仓 cecelia-deploy-main', () => {
    expect(COMPOSE).toContain('REPO_ROOT=/Users/administrator/perfect21/cecelia-deploy-main');
    expect(COMPOSE).not.toContain('REPO_ROOT=/Users/administrator/perfect21/cecelia\n');
  });
  it('专用部署根开启 AUTORESET 自愈', () => {
    expect(COMPOSE).toContain('CECELIA_DEPLOY_AUTORESET=1');
  });
  it('专用部署仓已挂载 rw', () => {
    expect(COMPOSE).toContain(
      '/Users/administrator/perfect21/cecelia-deploy-main:/Users/administrator/perfect21/cecelia-deploy-main:rw'
    );
  });
  it('西安 Fleet Worker 默认使用容器可达的固定 Tailscale IP', () => {
    expect(COMPOSE).toContain(
      'FLEET_WORKER_XIAN_MAC_M4_URL=${FLEET_WORKER_XIAN_MAC_M4_URL:-http://100.86.57.69:5231}'
    );
    expect(COMPOSE).toContain(
      'FLEET_WORKER_XIAN_MAC_M1_URL=${FLEET_WORKER_XIAN_MAC_M1_URL:-http://100.88.166.55:5231}'
    );
    expect(COMPOSE).not.toContain('http://xian-mac-m4:5231');
    expect(COMPOSE).not.toContain('http://xian-mac-m1:5231');
  });
});
