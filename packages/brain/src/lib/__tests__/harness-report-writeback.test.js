import { describe, expect, it, vi } from 'vitest';
import { finalizeHarnessReportFeature } from '../harness-report-writeback.js';

describe('harness report trusted feature writeback', () => {
  it('Brain callback marks the bound feature done and welds a test anchor', async () => {
    const db = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{
        id: 'feature-1', unit_test_path: null, workflow_ref: null, guard_ref: null,
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'feature-1', status: 'done' }] }) };
    const readChangedFiles = vi.fn(async () => ['src/foo.js', 'src/foo.test.js']);

    await expect(finalizeHarnessReportFeature(db, {
      featureId: 'feature-1', prUrl: 'https://github.com/acme/repo/pull/7', readChangedFiles,
    })).resolves.toMatchObject({ updated: true, unitTestPath: 'src/foo.test.js' });

    expect(db.query.mock.calls[1][0]).toContain("status = 'done'");
    expect(db.query.mock.calls[1][1]).toEqual(['feature-1', 'src/foo.test.js']);
  });

  it('existing anchor is preserved without asking the runner or GitHub again', async () => {
    const db = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{
        id: 'feature-1', unit_test_path: 'existing.test.js', workflow_ref: null, guard_ref: null,
      }] })
      .mockResolvedValueOnce({ rows: [{ id: 'feature-1', status: 'done' }] }) };
    const readChangedFiles = vi.fn();

    await finalizeHarnessReportFeature(db, {
      featureId: 'feature-1', prUrl: 'https://github.com/acme/repo/pull/7', readChangedFiles,
    });

    expect(readChangedFiles).not.toHaveBeenCalled();
    expect(db.query.mock.calls[1][1]).toEqual(['feature-1', null]);
  });
});
