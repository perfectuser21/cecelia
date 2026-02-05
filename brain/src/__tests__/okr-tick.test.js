/**
 * OKR Tick Tests
 * Tests for OKR state machine functionality
 */

import { describe, it, expect } from 'vitest';
import { areAllQuestionsAnswered, OKR_STATUS } from '../okr-tick.js';

describe('areAllQuestionsAnswered', () => {
  it('should return true when no questions exist', () => {
    const goal = { metadata: {} };
    expect(areAllQuestionsAnswered(goal)).toBe(true);
  });

  it('should return true when pending_questions is empty array', () => {
    const goal = { metadata: { pending_questions: [] } };
    expect(areAllQuestionsAnswered(goal)).toBe(true);
  });

  it('should return true when all questions are answered', () => {
    const goal = {
      metadata: {
        pending_questions: [
          { id: 'q1', question: 'Q1?', answered: true, answer: 'A1' },
          { id: 'q2', question: 'Q2?', answered: true, answer: 'A2' }
        ]
      }
    };
    expect(areAllQuestionsAnswered(goal)).toBe(true);
  });

  it('should return false when some questions are unanswered', () => {
    const goal = {
      metadata: {
        pending_questions: [
          { id: 'q1', question: 'Q1?', answered: true, answer: 'A1' },
          { id: 'q2', question: 'Q2?', answered: false, answer: null }
        ]
      }
    };
    expect(areAllQuestionsAnswered(goal)).toBe(false);
  });

  it('should return false when all questions are unanswered', () => {
    const goal = {
      metadata: {
        pending_questions: [
          { id: 'q1', question: 'Q1?', answered: false, answer: null }
        ]
      }
    };
    expect(areAllQuestionsAnswered(goal)).toBe(false);
  });

  it('should return true when metadata is null', () => {
    const goal = { metadata: null };
    expect(areAllQuestionsAnswered(goal)).toBe(true);
  });
});

describe('OKR_STATUS', () => {
  it('should have all expected statuses', () => {
    expect(OKR_STATUS).toHaveProperty('PENDING');
    expect(OKR_STATUS).toHaveProperty('NEEDS_INFO');
    expect(OKR_STATUS).toHaveProperty('READY');
    expect(OKR_STATUS).toHaveProperty('DECOMPOSING');
    expect(OKR_STATUS).toHaveProperty('IN_PROGRESS');
    expect(OKR_STATUS).toHaveProperty('COMPLETED');
    expect(OKR_STATUS).toHaveProperty('CANCELLED');
  });

  it('should have correct status values', () => {
    expect(OKR_STATUS.PENDING).toBe('pending');
    expect(OKR_STATUS.NEEDS_INFO).toBe('needs_info');
    expect(OKR_STATUS.READY).toBe('ready');
    expect(OKR_STATUS.DECOMPOSING).toBe('decomposing');
    expect(OKR_STATUS.IN_PROGRESS).toBe('in_progress');
    expect(OKR_STATUS.COMPLETED).toBe('completed');
    expect(OKR_STATUS.CANCELLED).toBe('cancelled');
  });
});
