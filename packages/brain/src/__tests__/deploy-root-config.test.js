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
});
