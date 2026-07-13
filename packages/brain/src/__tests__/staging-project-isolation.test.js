/**
 * staging-project-isolation.test.js
 * staging compose 必须声明独立 project name（cecelia-staging），否则与生产共用
 * project `cecelia` → staging 部署把生产容器当 orphan 误扫（issue f38f989f 次因）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const F = resolve(__dirname, '../../../../docker-compose.staging.yml');

describe('staging compose project isolation', () => {
  it('顶层声明 name: cecelia-staging（与生产 project cecelia 隔离）', () => {
    const txt = readFileSync(F, 'utf8');
    expect(txt).toMatch(/^name:\s*cecelia-staging\s*$/m);
  });
});
