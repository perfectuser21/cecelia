/** 技能工厂 workflow 配置合并（任务 a5f42455）：登记的 workflow 与 defaults 合并，未登记返回 null。 */
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFactoryConfig, resolveWorkflowConfig } from '../factory-workflow-config.js';

describe('resolveWorkflowConfig', () => {
  it('真配置：抖音视频发布登记了设备 / agent / 阈值 / 时段', () => {
    const c = resolveWorkflowConfig('douyin_video_publish.android');
    expect(c.device).toMatchObject({ node: 'XIAN-M4-PHONE', profile: 'xiaolongxia', serial: 'ANGYVB4311010223', ssh_host: 'xian-m4' });
    expect(c.agent).toBe('skill-factory');
    expect(c.retreat_fail_threshold).toBe(3);
    expect(c.publish_hours).toEqual([9, 23]);
    expect(c.stage_skills).toMatchObject({ 1: 'skill-explore', 2: 'skill-boundary' });
    expect(c.workflow_key).toBe('douyin_video_publish.android');
  });
  it('未登记的 workflow 返回 null（推进器据此标 resource，不猜）', () => {
    expect(resolveWorkflowConfig('nope.workflow')).toBeNull();
  });
  it('workflow 覆盖 defaults，dev / stage_skills 浅合并', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fwc-'));
    const p = join(dir, 'c.json');
    writeFileSync(p, JSON.stringify({
      defaults: { agent: 'skill-factory', stage_skills: { 1: 'a', 2: 'b' }, dev: { repo_hint: 'https://github.com/x/y', change_kind: 'bugfix' } },
      workflows: { w: { agent: 'other', stage_skills: { 2: 'bb' }, dev: { change_kind: 'capability_change' } } },
    }));
    const c = resolveWorkflowConfig('w', loadFactoryConfig(p));
    expect(c.agent).toBe('other');
    expect(c.stage_skills).toEqual({ 1: 'a', 2: 'bb' });
    expect(c.dev).toEqual({ repo_hint: 'https://github.com/x/y', change_kind: 'capability_change' });
    expect(c.anchor).toBeNull();
  });
});

// 固定运行配置必须出现在正式扫描器使用的真实模块依赖中，不能仅靠来源声明认领。
it('默认运行配置由原生依赖图绑定到实际读取器', async () => {
  const {cruise}=await import('dependency-cruiser');
  const {fileURLToPath}=await import('node:url');
  const root=fileURLToPath(new URL('../../../../../',import.meta.url));
  const previous=process.cwd();
  try {
    process.chdir(root);
    const result=await cruise(['packages/brain/src/lib/factory-workflow-config.js'],{baseDir:root,doNotFollow:{path:'node_modules'},exclude:{path:'node_modules'}});
    const graph=typeof result.output==='string'?JSON.parse(result.output):result.output;
    const reader=graph.modules.find(m=>m.source==='packages/brain/src/lib/factory-workflow-config.js');
    expect(reader.dependencies.some(d=>d.resolved==='packages/brain/config/factory-workflows.json'&&!d.couldNotResolve)).toBe(true);
  } finally {process.chdir(previous);}
});
