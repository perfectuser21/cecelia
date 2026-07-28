import { beforeEach, describe, expect, it, vi } from 'vitest';

const processExecutionCallbackMock = vi.fn();
const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const poolConnectMock = vi.fn(async () => ({
  query: clientQueryMock,
  release: clientReleaseMock,
}));

vi.mock('../db.js', () => ({
  default: { connect: (...args) => poolConnectMock(...args) },
}));
vi.mock('../callback-processor.js', () => ({
  processExecutionCallback: (...args) => processExecutionCallbackMock(...args),
}));

describe('callback worker Codex review contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientQueryMock.mockImplementation(async (sql) => {
      if (String(sql).includes('SELECT * FROM callback_queue')) {
        return {
          rows: [{
            id: 'queue-1',
            task_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            run_id: '11111111-2222-4333-8444-555555555555',
            status: 'AI Done',
            result_json: {
              verdict: 'PASS',
              _meta: { coding_type: 'codex-review' },
            },
          }],
        };
      }
      return { rows: [], rowCount: 1 };
    });
    processExecutionCallbackMock.mockResolvedValue({
      success: true,
      newStatus: 'completed',
    });
  });

  it('restores coding_type and exact verdict from durable queue metadata', async () => {
    const { buildDataFromRow } = await import('../callback-worker.js');
    expect(buildDataFromRow({
      task_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      run_id: 'ffffffff-1111-2222-3333-444444444444',
      status: 'AI Done',
      result_json: {
        verdict: 'FAIL',
        summary: 'blocker',
        issues: [],
        _meta: { coding_type: 'codex-review' },
      },
    })).toMatchObject({
      status: 'AI Done',
      coding_type: 'codex-review',
      result: {
        verdict: 'FAIL',
        summary: 'blocker',
        issues: [],
      },
    });
  });

  it('claims rows transactionally with SKIP LOCKED before processing', async () => {
    const { pollAndProcess } = await import('../callback-worker.js');
    await pollAndProcess();

    expect(clientQueryMock.mock.calls[0][0]).toBe('BEGIN');
    const select = clientQueryMock.mock.calls.find(([sql]) => (
      String(sql).includes('SELECT * FROM callback_queue')
    ));
    expect(select[0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(processExecutionCallbackMock).toHaveBeenCalledTimes(1);
    expect(clientQueryMock).toHaveBeenCalledWith(
      'UPDATE callback_queue SET processed_at = NOW() WHERE id = $1',
      ['queue-1'],
    );
    expect(clientQueryMock).toHaveBeenCalledWith('COMMIT');
    expect(clientReleaseMock).toHaveBeenCalledTimes(1);
  });
});
