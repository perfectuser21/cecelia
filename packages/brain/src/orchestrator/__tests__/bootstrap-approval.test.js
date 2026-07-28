import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  bootstrapApprovalMessage,
  verifyBootstrapApproval,
} from '../../../../../scripts/lib/verify-bootstrap-approval.mjs';

const axes = {
  repository: 'perfectuser21/cecelia',
  prNumber: '4501',
  sourceHeadSha: 'a'.repeat(40),
  mergeSha: 'b'.repeat(40),
  actor: 'owner',
  keyId: 'owner-v1',
};

describe('bootstrap offline owner approval', () => {
  it('is verifiable by an unprivileged deploy process using only the public key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const signatureBase64 = sign(
      'sha256',
      Buffer.from(bootstrapApprovalMessage(axes)),
      privateKey,
    ).toString('base64');
    expect(verifyBootstrapApproval({
      ...axes,
      publicKey,
      signatureBase64,
    })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a signature replayed with a changed release axis', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const signatureBase64 = sign(
      'sha256',
      Buffer.from(bootstrapApprovalMessage(axes)),
      privateKey,
    ).toString('base64');
    expect(() => verifyBootstrapApproval({
      ...axes,
      mergeSha: 'c'.repeat(40),
      publicKey,
      signatureBase64,
    })).toThrow('bootstrap_signature_invalid');
  });
});
