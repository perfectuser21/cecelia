/**
 * Dev Session Tests - KR1 Implementation
 *
 * Tests for headless /dev session management:
 * - Session ID generation and validation
 * - Session CRUD operations via API
 * - Quality gate validation
 * - Summary generation
 */

import { describe, it, expect, afterAll } from 'vitest';

const API_BASE = 'http://localhost:5211/api/system';

interface ApiResponse {
  success: boolean;
  [key: string]: unknown;
}

interface SessionResponse extends ApiResponse {
  session?: {
    session_id: string;
    branch: string;
    prd_path: string;
    project: string;
    status: string;
    steps: unknown[];
    quality_gates?: {
      all_passed: boolean;
    };
    summary?: {
      files_modified: string[];
      scripts_executed: string[];
      next_steps: string[];
      duration_ms: number;
    };
  };
}

describe('Dev Session API (KR1)', () => {
  const createdSessionIds: string[] = [];

  // Clean up test sessions after all tests
  afterAll(async () => {
    for (const sessionId of createdSessionIds) {
      try {
        // Delete from memory
        await fetch(`${API_BASE}/memory/dev_session_${sessionId}`, { method: 'DELETE' });
        await fetch(`${API_BASE}/memory/summary_${sessionId}`, { method: 'DELETE' });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Session ID Generation', () => {
    it('should generate a valid session ID', async () => {
      const response = await fetch(`${API_BASE}/dev-session/generate-id`);
      const data = (await response.json()) as ApiResponse;

      expect(data.success).toBe(true);
      expect(data.session_id).toBeDefined();

      // Validate format: dev_YYYYMMDD_HHMMSS_xxxxxx
      const sessionId = data.session_id as string;
      expect(sessionId).toMatch(/^dev_\d{8}_\d{6}_[a-z0-9]{6}$/);
    });

    it('should generate unique session IDs', async () => {
      const response1 = await fetch(`${API_BASE}/dev-session/generate-id`);
      const data1 = (await response1.json()) as ApiResponse;

      const response2 = await fetch(`${API_BASE}/dev-session/generate-id`);
      const data2 = (await response2.json()) as ApiResponse;

      expect(data1.session_id).not.toBe(data2.session_id);
    });
  });

  describe('Session Creation', () => {
    it('should create a new dev session', async () => {
      const response = await fetch(`${API_BASE}/dev-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: 'test-branch',
          prd_path: '.prd-test.md',
          project: 'test-project',
        }),
      });

      const data = (await response.json()) as SessionResponse;
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.session).toBeDefined();
      expect(data.session?.session_id).toMatch(/^dev_\d{8}_\d{6}_[a-z0-9]{6}$/);
      expect(data.session?.status).toBe('running');
      expect(data.session?.branch).toBe('test-branch');

      if (data.session?.session_id) {
        createdSessionIds.push(data.session.session_id);
      }
    });

    it('should reject session creation without required fields', async () => {
      const response = await fetch(`${API_BASE}/dev-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: 'test-branch',
          // missing prd_path and project
        }),
      });

      const data = (await response.json()) as ApiResponse;
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });

    it('should allow custom session ID', async () => {
      const customId = `dev_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${new Date().toISOString().slice(11, 19).replace(/:/g, '')}_custom`;

      const response = await fetch(`${API_BASE}/dev-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: 'test-branch-custom',
          prd_path: '.prd-test.md',
          project: 'test-project',
          session_id: customId,
        }),
      });

      const data = (await response.json()) as SessionResponse;
      expect(data.success).toBe(true);
      expect(data.session?.session_id).toBe(customId);

      if (data.session?.session_id) {
        createdSessionIds.push(data.session.session_id);
      }
    });
  });

  describe('Session Query', () => {
    it('should query dev sessions', async () => {
      const response = await fetch(`${API_BASE}/dev-session`);
      const data = (await response.json()) as ApiResponse;

      expect(data.success).toBe(true);
      expect(data.sessions).toBeDefined();
      expect(Array.isArray(data.sessions)).toBe(true);
    });

    it('should get a specific session by ID', async () => {
      // First create a session
      const createResponse = await fetch(`${API_BASE}/dev-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: 'test-get-branch',
          prd_path: '.prd-get-test.md',
          project: 'test-get-project',
        }),
      });

      const createData = (await createResponse.json()) as SessionResponse;
      const sessionId = createData.session?.session_id;

      if (sessionId) {
        createdSessionIds.push(sessionId);

        // Then get it
        const response = await fetch(`${API_BASE}/dev-session/${sessionId}`);
        const data = (await response.json()) as SessionResponse;

        expect(data.success).toBe(true);
        expect(data.session?.session_id).toBe(sessionId);
        expect(data.session?.branch).toBe('test-get-branch');
      }
    });

    it('should return 404 for non-existent session', async () => {
      const fakeId = 'dev_20260101_000000_fakeid';
      const response = await fetch(`${API_BASE}/dev-session/${fakeId}`);
      const data = (await response.json()) as ApiResponse;

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
    });
  });

  describe('Quality Gates', () => {
    it('should set quality gates on a session', async () => {
      // Create session
      const createResponse = await fetch(`${API_BASE}/dev-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: 'test-qg-branch',
          prd_path: '.prd-qg-test.md',
          project: 'test-qg-project',
        }),
      });

      const createData = (await createResponse.json()) as SessionResponse;
      const sessionId = createData.session?.session_id;

      if (sessionId) {
        createdSessionIds.push(sessionId);

        // Set quality gates
        const response = await fetch(`${API_BASE}/dev-session/${sessionId}/quality-gates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            qa_decision: true,
            audit_pass: true,
            gate_file: true,
          }),
        });

        const data = (await response.json()) as SessionResponse;
        expect(data.success).toBe(true);
        expect(data.quality_gates).toBeDefined();
        expect((data.quality_gates as { all_passed: boolean }).all_passed).toBe(true);
      }
    });

    it('should report all_passed=false when not all gates pass', async () => {
      // Create session
      const createResponse = await fetch(`${API_BASE}/dev-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: 'test-qg-fail-branch',
          prd_path: '.prd-qg-fail.md',
          project: 'test-qg-fail-project',
        }),
      });

      const createData = (await createResponse.json()) as SessionResponse;
      const sessionId = createData.session?.session_id;

      if (sessionId) {
        createdSessionIds.push(sessionId);

        // Set quality gates with one failing
        const response = await fetch(`${API_BASE}/dev-session/${sessionId}/quality-gates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            qa_decision: true,
            audit_pass: false, // This one fails
            gate_file: true,
          }),
        });

        const data = (await response.json()) as SessionResponse;
        expect(data.success).toBe(true);
        expect((data.quality_gates as { all_passed: boolean }).all_passed).toBe(false);
      }
    });
  });

  describe('Summary Generation', () => {
    it('should generate a session summary', async () => {
      // Create session
      const createResponse = await fetch(`${API_BASE}/dev-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: 'test-summary-branch',
          prd_path: '.prd-summary-test.md',
          project: 'test-summary-project',
        }),
      });

      const createData = (await createResponse.json()) as SessionResponse;
      const sessionId = createData.session?.session_id;

      if (sessionId) {
        createdSessionIds.push(sessionId);

        // Generate summary
        const response = await fetch(`${API_BASE}/dev-session/${sessionId}/summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        const data = (await response.json()) as ApiResponse;
        expect(data.success).toBe(true);
        expect(data.summary).toBeDefined();

        const summary = data.summary as {
          files_modified: string[];
          scripts_executed: string[];
          next_steps: string[];
          duration_ms: number;
          total_steps: number;
          completed_steps: number;
        };

        // Check summary structure
        expect(Array.isArray(summary.files_modified)).toBe(true);
        expect(Array.isArray(summary.scripts_executed)).toBe(true);
        expect(Array.isArray(summary.next_steps)).toBe(true);
        expect(typeof summary.duration_ms).toBe('number');
        expect(typeof summary.total_steps).toBe('number');
        expect(typeof summary.completed_steps).toBe('number');
      }
    });

    it('should store summary in episodic memory', async () => {
      // Create session
      const createResponse = await fetch(`${API_BASE}/dev-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: 'test-memory-branch',
          prd_path: '.prd-memory-test.md',
          project: 'test-memory-project',
        }),
      });

      const createData = (await createResponse.json()) as SessionResponse;
      const sessionId = createData.session?.session_id;

      if (sessionId) {
        createdSessionIds.push(sessionId);

        // Generate summary
        await fetch(`${API_BASE}/dev-session/${sessionId}/summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        // Check memory for summary
        const memoryResponse = await fetch(`${API_BASE}/memory/summary_${sessionId}`);
        const memoryData = (await memoryResponse.json()) as ApiResponse;

        expect(memoryData.success).toBe(true);
        expect(memoryData.entry).toBeDefined();
      }
    });
  });

  describe('Session Completion', () => {
    it('should complete a session successfully', async () => {
      // Create session
      const createResponse = await fetch(`${API_BASE}/dev-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: 'test-complete-branch',
          prd_path: '.prd-complete-test.md',
          project: 'test-complete-project',
        }),
      });

      const createData = (await createResponse.json()) as SessionResponse;
      const sessionId = createData.session?.session_id;

      if (sessionId) {
        createdSessionIds.push(sessionId);

        // Complete session
        const response = await fetch(`${API_BASE}/dev-session/${sessionId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'completed',
            pr_url: 'https://github.com/test/repo/pull/123',
          }),
        });

        const data = (await response.json()) as SessionResponse;
        expect(data.success).toBe(true);
        expect(data.session?.status).toBe('completed');
        expect(data.session?.summary).toBeDefined();
      }
    });

    it('should mark session as failed', async () => {
      // Create session
      const createResponse = await fetch(`${API_BASE}/dev-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: 'test-fail-branch',
          prd_path: '.prd-fail-test.md',
          project: 'test-fail-project',
        }),
      });

      const createData = (await createResponse.json()) as SessionResponse;
      const sessionId = createData.session?.session_id;

      if (sessionId) {
        createdSessionIds.push(sessionId);

        // Fail session
        const response = await fetch(`${API_BASE}/dev-session/${sessionId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'failed',
          }),
        });

        const data = (await response.json()) as SessionResponse;
        expect(data.success).toBe(true);
        expect(data.session?.status).toBe('failed');
      }
    });
  });
});
