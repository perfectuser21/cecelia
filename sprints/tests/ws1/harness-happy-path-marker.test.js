// Workstream 1 — BEHAVIOR test for harness happy-path marker module.
// Generator must copy this file VERBATIM into:
//   packages/brain/tests/ws1/harness-happy-path-marker.test.js
// (CI enforces no diff between sprints/tests/ws1/ and packages/brain/tests/ws1/.)
//
// Import path '../../src/...' assumes the test lives at packages/brain/tests/ws1/.
// In sprints/tests/ws1/ the path resolves to a non-existent file → vitest reports
// a load-time failure. That non-resolution IS the Red evidence in the proposer
// phase; in PR HEAD the test resolves correctly and runs as Green.

import { describe, it, expect } from 'vitest';
import {
  HARNESS_HAPPY_PATH_MARKER,
  verifyHarnessHappyPath,
} from '../../src/harness-happy-path-marker.js';

describe('Workstream 1 — harness happy-path marker [BEHAVIOR]', () => {
  it('exports HARNESS_HAPPY_PATH_MARKER carrying the child task signature', () => {
    expect(HARNESS_HAPPY_PATH_MARKER).toBe('fe91ce26-5nodes-verified');
  });

  it('verifyHarnessHappyPath() returns the same marker string', () => {
    expect(typeof verifyHarnessHappyPath).toBe('function');
    expect(verifyHarnessHappyPath()).toBe('fe91ce26-5nodes-verified');
  });
});
