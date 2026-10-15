import { describe, it, expect } from 'vitest';
import { resolveWorkflowConfig } from '../factory-workflow-config.js';

describe('四独立获客正规入口配置', () => {
  for (const key of ['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach']) {
    it(`${key} 进入已冻结 leadgen-run 而非旧 Commander agent`, () => {
      const config = resolveWorkflowConfig(key);
      expect(config?.dispatch_via).toBe('leadgen-run-v1');
      expect(config?.leadgen?.workflow_id).toMatch(/^b1000000-0000-4000-8000-00000000010[1-4]$/);
    });
  }
});
