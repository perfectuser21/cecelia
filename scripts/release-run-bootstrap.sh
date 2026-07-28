#!/usr/bin/env bash
# One-time N-1 -> ReleaseRun bootstrap. Explicit owner approval, exact SHA,
# durable append-only DB receipt, and single consumption are mandatory.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
merge_sha="${KERNEL_RELEASE_MERGE_SHA:-}"
approved_sha="${KERNEL_RELEASE_OWNER_APPROVED_SHA:-}"
approval="${KERNEL_RELEASE_BOOTSTRAP_APPROVAL:-}"
owner_secret="${KERNEL_RELEASE_BOOTSTRAP_OWNER_SECRET:-}"
actor="${KERNEL_RELEASE_BOOTSTRAP_ACTOR:-}"

[[ "${KERNEL_RELEASE_BOOTSTRAP:-0}" == "1" ]] || { echo "bootstrap disabled" >&2; exit 78; }
[[ "$merge_sha" =~ ^[0-9a-f]{40}$ && "$approved_sha" == "$merge_sha" ]] \
  || { echo "bootstrap exact-SHA owner approval required" >&2; exit 78; }
[[ ${#owner_secret} -ge 32 && -n "$actor" ]] \
  || { echo "bootstrap owner approval credential required" >&2; exit 78; }
expected_approval=$(printf '%s' "${merge_sha}:${actor}" \
  | openssl dgst -sha256 -hmac "$owner_secret" -r | awk '{print $1}')
[[ "$approval" == "$expected_approval" ]] \
  || { echo "bootstrap owner approval signature invalid" >&2; exit 78; }
command -v psql >/dev/null || { echo "bootstrap requires psql" >&2; exit 78; }

approval_digest=$(printf '%s' "$approval" | shasum -a 256 | awk '{print $1}')
receipt_id=$(psql -XAtv ON_ERROR_STOP=1 \
  -v merge_sha="$merge_sha" -v actor="$actor" -v digest="$approval_digest" <<'SQL'
BEGIN;
CREATE TABLE IF NOT EXISTS kernel_release_bootstrap_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton BOOLEAN NOT NULL UNIQUE DEFAULT TRUE CHECK (singleton),
  merge_sha TEXT NOT NULL CHECK (merge_sha ~ '^[0-9a-f]{40}$'),
  approved_by TEXT NOT NULL,
  approval_digest TEXT NOT NULL CHECK (approval_digest ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS kernel_release_bootstrap_consumptions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_id UUID NOT NULL UNIQUE REFERENCES kernel_release_bootstrap_receipts(id),
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION kernel_release_bootstrap_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'kernel release bootstrap audit is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_kernel_release_bootstrap_receipts_append_only
  ON kernel_release_bootstrap_receipts;
CREATE TRIGGER trg_kernel_release_bootstrap_receipts_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_bootstrap_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_release_bootstrap_append_only();
DROP TRIGGER IF EXISTS trg_kernel_release_bootstrap_consumptions_append_only
  ON kernel_release_bootstrap_consumptions;
CREATE TRIGGER trg_kernel_release_bootstrap_consumptions_append_only
  BEFORE UPDATE OR DELETE ON kernel_release_bootstrap_consumptions
  FOR EACH ROW EXECUTE FUNCTION kernel_release_bootstrap_append_only();
INSERT INTO kernel_release_bootstrap_receipts (merge_sha, approved_by, approval_digest)
VALUES (:'merge_sha', :'actor', :'digest')
RETURNING id;
COMMIT;
SQL
)
receipt_id=$(printf '%s\n' "$receipt_id" | grep -E '^[0-9a-f-]{36}$' | tail -1)
[[ -n "$receipt_id" ]] || { echo "bootstrap receipt creation failed or already used" >&2; exit 78; }

git -C "$repo_root" fetch --no-tags origin "$merge_sha" || git -C "$repo_root" fetch origin main
git -C "$repo_root" checkout --force --detach "$merge_sha"
[[ "$(git -C "$repo_root" rev-parse HEAD)" == "$merge_sha" ]]

KERNEL_RELEASE_BOOTSTRAP_RECEIPT="$receipt_id" \
  bash "$repo_root/scripts/brain-deploy.sh"
