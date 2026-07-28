import { createHash, createPublicKey, verify } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function bootstrapApprovalMessage({
  repository,
  prNumber,
  sourceHeadSha,
  mergeSha,
  actor,
  keyId,
}) {
  return [
    `repository=${repository}`,
    `pr_number=${prNumber}`,
    `source_head_sha=${sourceHeadSha}`,
    `merge_sha=${mergeSha}`,
    `actor=${actor}`,
    `key_id=${keyId}`,
    '',
  ].join('\n');
}

export function verifyBootstrapApproval({ publicKey, signatureBase64, ...axes }) {
  const signature = Buffer.from(signatureBase64, 'base64');
  if (signature.length === 0 || signature.toString('base64') !== signatureBase64) {
    throw new Error('bootstrap_signature_encoding_invalid');
  }
  const verificationKey = publicKey?.type === 'public'
    ? publicKey
    : createPublicKey(publicKey);
  const valid = verify(
    'sha256',
    Buffer.from(bootstrapApprovalMessage(axes)),
    verificationKey,
    signature,
  );
  if (!valid) throw new Error('bootstrap_signature_invalid');
  return createHash('sha256').update(signature).digest('hex');
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [
      trustKey,
      repository,
      prNumber,
      sourceHeadSha,
      mergeSha,
      actor,
      keyId,
      signatureBase64,
    ] = process.argv.slice(2);
    const stat = lstatSync(trustKey);
    if (stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o777) !== 0o444) {
      throw new Error('bootstrap_trust_root_permissions_invalid');
    }
    const digest = verifyBootstrapApproval({
      publicKey: readFileSync(trustKey),
      signatureBase64,
      repository,
      prNumber,
      sourceHeadSha,
      mergeSha,
      actor,
      keyId,
    });
    process.stdout.write(digest);
  } catch {
    process.exitCode = 1;
  }
}
