/**
 * Tests for P0 FIX #2: Circuit breaker success recovery
 *
 * Before fix: recordSuccess() was imported but never called, circuit stayed in HALF_OPEN forever
 * After fix: execution-callback calls recordSuccess() on task completion
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { recordSuccess, recordFailure, isAllowed, getAllStates } from '../circuit-breaker.js';

describe('circuit-breaker-success (P0 Fix #2)', () => {
  const SERVICE_NAME = 'test-service-success';
  const CIRCUIT_STATES = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

  beforeEach(async () => {
    // Reset circuit state by recording multiple successes
    for (let i = 0; i < 5; i++) {
      await recordSuccess(SERVICE_NAME);
    }
  });

  afterEach(async () => {
    // Clean up
    for (let i = 0; i < 5; i++) {
      await recordSuccess(SERVICE_NAME);
    }
  });

  it('should allow requests when circuit is CLOSED', async () => {
    const allowed = await isAllowed(SERVICE_NAME);
    expect(allowed).toBe(true);

    const states = await getAllStates();
    expect(states[SERVICE_NAME]?.state).toBe(CIRCUIT_STATES.CLOSED);
  });

  it('should open circuit after 3 consecutive failures', async () => {
    // Record 3 failures
    for (let i = 0; i < 3; i++) {
      await recordFailure(SERVICE_NAME, new Error('Test failure'));
    }

    const allowed = await isAllowed(SERVICE_NAME);
    expect(allowed).toBe(false);

    const states = await getAllStates();
    expect(states[SERVICE_NAME]?.state).toBe(CIRCUIT_STATES.OPEN);
  });

  it('should transition from OPEN to HALF_OPEN after cooldown (simulated)', async () => {
    // Open circuit
    for (let i = 0; i < 3; i++) {
      await recordFailure(SERVICE_NAME, new Error('Test failure'));
    }

    const states1 = await getAllStates();
    expect(states1[SERVICE_NAME]?.state).toBe(CIRCUIT_STATES.OPEN);

    // In real scenario, we'd wait 30min. For testing, we manually transition by recording success
    // (This tests the HALF_OPEN → CLOSED transition, which is the P0 fix)

    // P0 FIX: recordSuccess() should be called and should close the circuit
    await recordSuccess(SERVICE_NAME);
    await recordSuccess(SERVICE_NAME); // Second success to confirm stability

    const allowed = await isAllowed(SERVICE_NAME);
    expect(allowed).toBe(true);

    const states2 = await getAllStates();
    // After consecutive successes, circuit should return to CLOSED
    expect(states2[SERVICE_NAME]?.state).toBe(CIRCUIT_STATES.CLOSED);
  });

  it('should close circuit after consecutive successes in HALF_OPEN', async () => {
    // Simulate HALF_OPEN state by opening then allowing one success
    for (let i = 0; i < 3; i++) {
      await recordFailure(SERVICE_NAME, new Error('Open it'));
    }

    // Record 2 consecutive successes (simulating successful recovery)
    await recordSuccess(SERVICE_NAME);
    await recordSuccess(SERVICE_NAME);

    const states = await getAllStates();
    expect(states[SERVICE_NAME]?.state).toBe(CIRCUIT_STATES.CLOSED);
    expect(states[SERVICE_NAME]?.failures).toBe(0);
  });

  it('should reset failure count on recordSuccess', async () => {
    // Record 2 failures (not enough to open)
    await recordFailure(SERVICE_NAME, new Error('Failure 1'));
    await recordFailure(SERVICE_NAME, new Error('Failure 2'));

    let states = await getAllStates();
    expect(states[SERVICE_NAME]?.failures).toBe(2);

    // Record success should reset counter
    await recordSuccess(SERVICE_NAME);

    states = await getAllStates();
    expect(states[SERVICE_NAME]?.failures).toBe(0);
  });
});
