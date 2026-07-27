/**
 * WarRoomGoldenPathPage 存在性与路由注册单测（TDD Red 阶段）
 *
 * [BEHAVIOR] — WarRoomGoldenPathPage.tsx 存在
 * [BEHAVIOR] — system-hub/index.ts 注册 /warroom/gp/:gpId 路由
 * [BEHAVIOR] — App.tsx isFullHeightRoute 覆盖 /warroom/gp
 *
 * 这些测试在文件未创建时 RED。
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../../../..');

describe('WarRoomGoldenPathPage.tsx 存在', () => {
  it('WarRoomGoldenPathPage.tsx 存在', () => {
    const filePath = resolve(REPO_ROOT, 'apps/dashboard/src/pages/warroom/WarRoomGoldenPathPage.tsx');
    expect(existsSync(filePath)).toBe(true);
  });

  it('WarRoomGoldenPathPage.tsx 含 ConversationsPanel 引用', () => {
    const filePath = resolve(REPO_ROOT, 'apps/dashboard/src/pages/warroom/WarRoomGoldenPathPage.tsx');
    if (!existsSync(filePath)) {
      throw new Error('WarRoomGoldenPathPage.tsx 不存在');
    }
    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('ConversationsPanel');
  });

  it('WarRoomGoldenPathPage.tsx 含 gpId 参数处理', () => {
    const filePath = resolve(REPO_ROOT, 'apps/dashboard/src/pages/warroom/WarRoomGoldenPathPage.tsx');
    if (!existsSync(filePath)) {
      throw new Error('WarRoomGoldenPathPage.tsx 不存在');
    }
    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('gpId');
  });
});

describe('路由注册：system-hub/index.ts', () => {
  it('system-hub/index.ts 注册 /warroom/gp/:gpId 路由', () => {
    const filePath = resolve(REPO_ROOT, 'apps/api/features/system-hub/index.ts');
    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('warroom/gp');
  });

  it('system-hub/index.ts 注册 WarRoomGoldenPathPage pageComponent', () => {
    const filePath = resolve(REPO_ROOT, 'apps/api/features/system-hub/index.ts');
    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('WarRoomGoldenPathPage');
  });
});

describe('App.tsx isFullHeightRoute 覆盖 /warroom/gp', () => {
  it('App.tsx isFullHeightRoute 包含 warroom/gp', () => {
    const filePath = resolve(REPO_ROOT, 'apps/dashboard/src/App.tsx');
    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('warroom/gp');
  });
});
