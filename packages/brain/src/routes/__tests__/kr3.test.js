import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../kr3-config-checker.js', () => ({
  checkKR3ConfigDB: vi.fn(),
  markWxPayConfigured: vi.fn(),
  markAdminOidInitialized: vi.fn(),
  markKR3Milestone: vi.fn(),
  readLocalPayCredentials: vi.fn(),
  autoMarkKR3IfLocalCredentialsReady: vi.fn(),
}));

vi.mock('../../kr3-progress-calculator.js', () => ({
  KR3_MILESTONE_KEYS: {
    CLOUD_FUNCTIONS_DEPLOYED: 'kr3_cloud_functions_deployed',
    INTERNAL_TEST_STARTED: 'kr3_internal_test_started',
    REAL_DEVICE_BUGS_CLEARED: 'kr3_real_device_bugs_cleared',
    TRIAL_VERSION_SUBMITTED: 'kr3_trial_version_submitted',
    AUDIT_PASSED: 'kr3_audit_passed',
    WX_PAY_CONFIGURED: 'kr3_wx_pay_configured',
  },
  calculateAndWrite: vi.fn(),
}));

import express from 'express';
import request from 'supertest';
import kr3Router from '../kr3.js';
import {
  checkKR3ConfigDB,
  markKR3Milestone,
} from '../../kr3-config-checker.js';
import { calculateAndWrite } from '../../kr3-progress-calculator.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/kr3', kr3Router);
  return app;
}

describe('kr3 router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /kr3/check-config returns allReady when both configured', async () => {
    checkKR3ConfigDB.mockResolvedValue({ wxPayConfigured: true, adminOidReady: true });
    const res = await request(makeApp()).get('/kr3/check-config');
    expect(res.status).toBe(200);
    expect(res.body.allReady).toBe(true);
  });

  it('GET /kr3/progress returns progress_pct', async () => {
    calculateAndWrite.mockResolvedValue({ progress_pct: 70, stage: 'code_ready', written: true, breakdown: {} });
    const res = await request(makeApp()).get('/kr3/progress');
    expect(res.status).toBe(200);
    expect(res.body.progress_pct).toBe(70);
  });

  it('POST /kr3/mark-cloud-functions-deployed calls markKR3Milestone', async () => {
    markKR3Milestone.mockResolvedValue({ ok: true, topic: 'kr3_cloud_functions_deployed' });
    const res = await request(makeApp()).post('/kr3/mark-cloud-functions-deployed');
    expect(res.status).toBe(200);
    expect(markKR3Milestone).toHaveBeenCalledWith(undefined, 'kr3_cloud_functions_deployed', expect.any(String));
  });
});
