import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

const APP_TSX = resolve(__dirname, '../../../apps/dashboard/src/App.tsx');

describe('Cecelia Dashboard 首页固定状态标识文字 [BEHAVIOR]', () => {
  it('App.tsx 包含固定状态文字 "Cecelia Harness 工厂线已贯通"', () => {
    const content = readFileSync(APP_TSX, 'utf8');
    expect(content).toContain('Cecelia Harness 工厂线已贯通');
  });

  it('App.tsx 包含 data-testid="harness-status-banner" 供 Playwright 定位', () => {
    const content = readFileSync(APP_TSX, 'utf8');
    expect(content).toContain('data-testid="harness-status-banner"');
  });
});
