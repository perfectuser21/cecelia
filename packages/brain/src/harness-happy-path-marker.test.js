import { describe, it, expect } from 'vitest';
import {
  HARNESS_HAPPY_PATH_MARKER,
  verifyHarnessHappyPath,
} from './harness-happy-path-marker.js';

describe('harness-happy-path-marker (sibling pairing test)', () => {
  it('exports HARNESS_HAPPY_PATH_MARKER carrying the child task signature', () => {
    expect(HARNESS_HAPPY_PATH_MARKER).toBe('fe91ce26-5nodes-verified');
  });

  it('verifyHarnessHappyPath() returns the same marker string', () => {
    expect(typeof verifyHarnessHappyPath).toBe('function');
    expect(verifyHarnessHappyPath()).toBe('fe91ce26-5nodes-verified');
  });
});
