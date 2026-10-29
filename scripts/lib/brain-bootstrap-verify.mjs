import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const IMAGE = /^sha256:[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const FIELDS = [
  'schema_version', 'old_version', 'old_image_id', 'old_git_sha',
  'new_version', 'new_image_id', 'new_git_sha',
  'approval_decision_id', 'expires_at',
];

export function verifyBootstrapReceipt(receipt, actual, now = Date.now()) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
      || Object.keys(receipt).sort().join('|') !== [...FIELDS].sort().join('|')) {
    throw new Error('bootstrap_receipt_schema_invalid');
  }
  if (receipt.schema_version !== 'brain-drain-bootstrap/v1'
      || receipt.old_version !== '1.445.84'
      || !/^1\.\d+\.\d+$/.test(receipt.new_version)
      || !IMAGE.test(receipt.old_image_id) || !IMAGE.test(receipt.new_image_id)
      || !SHA.test(receipt.old_git_sha) || !SHA.test(receipt.new_git_sha)
      || !UUID.test(receipt.approval_decision_id)) {
    throw new Error('bootstrap_receipt_identity_invalid');
  }
  const expiry = Date.parse(receipt.expires_at);
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 30 * 60 * 1000) {
    throw new Error('bootstrap_receipt_expired_or_too_long');
  }
  for (const key of ['old_version', 'old_image_id', 'old_git_sha',
    'new_version', 'new_image_id', 'new_git_sha']) {
    if (receipt[key] !== actual[key]) throw new Error(`bootstrap_${key}_mismatch`);
  }
  if (actual.old_health_version !== receipt.old_version
      || actual.old_health_git_sha !== receipt.old_git_sha
      || actual.old_container_health_version !== receipt.old_version
      || actual.old_container_health_git_sha !== receipt.old_git_sha
      || actual.old_image_git_sha !== receipt.old_git_sha
      || actual.new_image_git_sha !== receipt.new_git_sha) {
    throw new Error('bootstrap_runtime_identity_mismatch');
  }
  if (receipt.old_image_id === receipt.new_image_id || receipt.old_git_sha === receipt.new_git_sha) {
    throw new Error('bootstrap_no_version_change');
  }
  return receipt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const receipt = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const actual = JSON.parse(process.env.BOOTSTRAP_ACTUAL_JSON || 'null');
    const valid = verifyBootstrapReceipt(receipt, actual);
    process.stdout.write(JSON.stringify(valid));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
