import { describe, expect, it, vi } from 'vitest';

vi.mock('../gp-assertion-command.js', () => ({
  assertionRunnerError: (code, message) => Object.assign(
    new Error(message),
    { code, shared_error_contract: true },
  ),
}));

describe('GP assertion toolchain wiring', () => {
  it('uses the connected assertion command error contract', async () => {
    const { createToolchainAttestation } = await import(
      '../gp-assertion-toolchain.js'
    );

    await expect(createToolchainAttestation({})).rejects.toMatchObject({
      code: 'ASSERTION_RUNNER_DIGEST_REQUIRED',
      shared_error_contract: true,
    });
  });
});
