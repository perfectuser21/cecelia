/**
 * preview-agent.test.js — MMV 侧预览执行代理
 *
 * 背景（2026-09-16/17）：Deploy Preview 自 09-09 搬到 us-vps 后一次没成功过
 * （preview_environments 842 次历史 → 归零）。整套功能本就是 Mac 专用：
 *   - preview-env-start.sh 硬编码 /Users/administrator/... 路径
 *   - 磁盘门槛 35G 底线 + 3.5G 预留 = 38.5G，按 Mac 盘设计；us-vps 根分区仅 24G，
 *     数学上不可能通过
 * 且"起预览环境" = 起 Brain + 克隆库，本属执行活，违反 us-vps 零执行铁律（96054a8b）。
 *
 * 本代理让执行回到执行机：Mac 上跑，复用 routes/preview.js 的全部逻辑与鉴权，
 * 接口路径与 Brain 完全一致，CI 只需改指向、不改脚本、不加 secret。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const AGENT = join(ROOT, 'scripts/preview-agent.mjs');

describe('preview-agent — 存在性与形状', () => {
  it('代理脚本存在', () => {
    expect(existsSync(AGENT)).toBe(true);
  });

  const src = () => readFileSync(AGENT, 'utf8');

  it('复用 routes/preview.js，不另写一套预览逻辑（防两份实现漂移）', () => {
    expect(src()).toMatch(/routes\/preview\.js/);
  });

  it('挂载路径与 Brain 一致 /api/brain/preview，CI 才能只改地址不改脚本', () => {
    expect(src()).toMatch(/['"]\/api\/brain\/preview['"]/);
  });

  it('提供 /api/brain/health，CI 的连通性探测依赖它', () => {
    expect(src()).toMatch(/\/api\/brain\/health/);
  });

  it('缺 DEPLOY_TOKEN 时拒绝启动——否则等于在内网裸奔', () => {
    const s = src();
    expect(s).toMatch(/DEPLOY_TOKEN/);
    expect(s).toMatch(/process\.exit\(1\)/);
  });

  it('只监听内网地址，不得绑 0.0.0.0 暴露公网', () => {
    const s = src();
    expect(s).not.toMatch(/listen\([^)]*['"]0\.0\.0\.0['"]/);
    expect(s).toMatch(/PREVIEW_AGENT_HOST|127\.0\.0\.1/);
  });

  it('默认端口 5231，与 socat 占用的 5221 错开', () => {
    expect(src()).toMatch(/5231/);
  });
});

describe('preview-agent — CI 指向执行机', () => {
  const wf = () => readFileSync(join(ROOT, '.github/workflows/preview-deploy.yml'), 'utf8');

  it('workflow 默认地址指向 MMV 的代理端口，不再指 us-vps', () => {
    const s = wf();
    expect(s).toMatch(/100\.71\.151\.105:5231/);
    expect(s).not.toMatch(/100\.79\.41\.61:5221/);
  });

  it('未引入新 secret —— 沿用既有 DEPLOY_TOKEN', () => {
    const s = wf();
    expect(s).toMatch(/secrets\.DEPLOY_TOKEN/);
    expect(s).not.toMatch(/PREVIEW_SSH_KEY/);
  });
});
