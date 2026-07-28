#!/usr/bin/env bash
# ReleaseRun-owned Workflow Skills promotion. Staging copies the exact snapshot
# into an isolated slot; production atomically repoints explicitly configured
# account skill roots to the exact deploy tree.
set -euo pipefail

workflow_root="$(cd "$(dirname "$0")/../../.." && pwd)"
deployment_root="${KERNEL_RELEASE_DEPLOY_ROOT:-$workflow_root}"
effect_kind="production"
[[ "${1:-}" == "--staging" ]] && effect_kind="staging"

bash "$workflow_root/scripts/lib/release-run-guard.sh" "$effect_kind"

release_run_id="${KERNEL_RELEASE_RUN_ID:-}"
artifact_root="${KERNEL_RELEASE_ARTIFACT_ROOT:-}"
source_dir="$artifact_root/packages/workflows/skills"
[[ "$release_run_id" =~ ^[0-9a-fA-F-]{36}$ \
   && "$artifact_root" == /* \
   && -f "$artifact_root/.release-snapshot.json" \
   && -d "$source_dir" ]] || {
  echo "Workflow Skills promotion blocked: invalid ReleaseRun source" >&2
  exit 78
}
node -e '
  const fs = require("node:fs");
  const receipt = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (
    receipt.schema_version !== 1
    || receipt.source !== "git-archive"
    || receipt.merge_sha !== process.env.KERNEL_RELEASE_MERGE_SHA
  ) process.exit(78);
' "$artifact_root/.release-snapshot.json" || {
  echo "Workflow Skills promotion blocked: snapshot identity mismatch" >&2
  exit 78
}

if [[ "$effect_kind" == "staging" ]]; then
  staging_root="${KERNEL_RELEASE_SKILLS_STAGING_ROOT:-$workflow_root/.release-staging/workflow-skills}"
  [[ "$staging_root" == /* ]] || {
    echo "Workflow Skills staging blocked: staging root must be absolute" >&2
    exit 78
  }
  destination="$staging_root/$release_run_id"
  temporary="${destination}.next.$$"
  mkdir -p "$staging_root"
  rm -rf "$temporary"
  cp -R "$source_dir" "$temporary"
  [[ -f "$temporary/harness-evaluator/SKILL.md" ]] || {
    rm -rf "$temporary"
    echo "Workflow Skills staging blocked: copied snapshot is incomplete" >&2
    exit 78
  }
  if [[ -e "$destination" ]]; then
    previous="${destination}.previous.$$"
    mv "$destination" "$previous"
    mv "$temporary" "$destination"
    rm -rf "$previous"
  else
    mv "$temporary" "$destination"
  fi
  exit 0
fi

deploy_roots="${CECELIA_SKILLS_DEPLOY_ROOTS:-}"
[[ -n "$deploy_roots" ]] || {
  echo "Workflow Skills production blocked: CECELIA_SKILLS_DEPLOY_ROOTS unavailable" >&2
  exit 78
}

rollback_dir="$deployment_root/logs/release-rollbacks/workflow-skills"
rollback_manifest="$rollback_dir/${release_run_id}.links"
receipt_file="$rollback_dir/${release_run_id}.json"
mkdir -p "$rollback_dir"
chmod 700 "$rollback_dir"
temporary_manifest="${rollback_manifest}.next.$$"
: > "$temporary_manifest"
chmod 600 "$temporary_manifest"

old_ifs="$IFS"
IFS=':'
for account_root in $deploy_roots; do
  [[ "$account_root" == /* && -d "$account_root" ]] || {
    echo "Workflow Skills production blocked: invalid configured account root" >&2
    exit 78
  }
  skills_root="$account_root/skills"
  mkdir -p "$skills_root"
  for skill_dir in "$source_dir"/*; do
    [[ -d "$skill_dir" && -f "$skill_dir/SKILL.md" ]] || continue
    skill_name="${skill_dir##*/}"
    live_skill="$skills_root/$skill_name"
    [[ ! -e "$live_skill" || -L "$live_skill" ]] || {
      rm -f "$temporary_manifest"
      echo "Workflow Skills production blocked: live skill is not a managed symlink" >&2
      exit 78
    }
    printf '%s\t%s\n' "$live_skill" "$(readlink "$live_skill" 2>/dev/null || echo absent)" \
      >> "$temporary_manifest"
  done
done
IFS="$old_ifs"
mv "$temporary_manifest" "$rollback_manifest"

previous_digest=$(node -e '
  const fs = require("node:fs");
  const crypto = require("node:crypto");
  const value = fs.readFileSync(process.argv[1]);
  process.stdout.write(crypto.createHash("sha256").update(value).digest("hex"));
' "$rollback_manifest")

IFS=':'
for account_root in $deploy_roots; do
  skills_root="$account_root/skills"
  for skill_dir in "$source_dir"/*; do
    [[ -d "$skill_dir" && -f "$skill_dir/SKILL.md" ]] || continue
    skill_name="${skill_dir##*/}"
    temporary_link="$skills_root/.${skill_name}.release-next.$$"
    ln -s "$skill_dir" "$temporary_link"
    node -e '
      const fs = require("node:fs");
      fs.renameSync(process.argv[1], process.argv[2]);
    ' "$temporary_link" "$skills_root/$skill_name"
    [[ "$(readlink "$skills_root/$skill_name")" == "$skill_dir" ]] || {
      echo "Workflow Skills production blocked: live readback mismatch" >&2
      exit 78
    }
  done
done
IFS="$old_ifs"

PREVIOUS_DIGEST="$previous_digest" RECEIPT_FILE="$receipt_file" node -e '
  const fs = require("node:fs");
  const artifacts = JSON.parse(process.env.KERNEL_RELEASE_ARTIFACT_VERSIONS || "[]");
  const artifact = artifacts.find((value) => value.name === "workflow-skills");
  if (!artifact || !/^sha256:[0-9a-f]{64}$/.test(artifact.digest || "")) process.exit(78);
  fs.writeFileSync(process.env.RECEIPT_FILE, JSON.stringify({
    anchor: `workflow-skills:${artifact.digest}`,
    previous_version: `workflow-skills:sha256:${process.env.PREVIOUS_DIGEST}`,
  }), { mode: 0o600 });
  fs.chmodSync(process.env.RECEIPT_FILE, 0o600);
'
