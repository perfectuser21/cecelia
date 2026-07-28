#!/usr/bin/env bash
# ReleaseRun-owned Workflow Skills promotion. Staging copies the exact snapshot
# into an isolated slot; production atomically repoints explicitly configured
# account skill roots to the exact deploy tree.
set -euo pipefail

workflow_root="$(cd "$(dirname "$0")/../../.." && pwd)"
deployment_root="${KERNEL_RELEASE_DEPLOY_ROOT:-$workflow_root}"
effect_kind="production"
[[ "${1:-}" == "--staging" ]] && effect_kind="staging"

if [[ "${1:-}" == "--rollback" ]]; then
  bash "$workflow_root/scripts/lib/release-run-rollback-guard.sh"
else
  bash "$workflow_root/scripts/lib/release-run-guard.sh" "$effect_kind"
fi

release_run_id="${KERNEL_RELEASE_RUN_ID:-}"
if [[ "${1:-}" == "--rollback" ]]; then
  requested_run_id="${2:-}"
  expected_digest="${KERNEL_RELEASE_ROLLBACK_EXPECTED_DIGEST:-}"
  expected_current_digest="${KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_DIGEST:-}"
  rollback_manifest="$deployment_root/logs/release-rollbacks/workflow-skills/${release_run_id}.links"
  [[ "$requested_run_id" == "$release_run_id" \
     && "$release_run_id" =~ ^[0-9a-fA-F-]{36}$ \
     && "$expected_digest" =~ ^sha256:[0-9a-f]{64}$ \
     && "$expected_current_digest" =~ ^sha256:[0-9a-f]{64}$ \
     && -f "$rollback_manifest" \
     && ! -L "$rollback_manifest" ]] || {
    echo "Workflow Skills rollback blocked: exact manifest unavailable" >&2
    exit 78
  }
  manifest_digest=$(node -e '
    const fs = require("node:fs");
    const crypto = require("node:crypto");
    process.stdout.write("sha256:" + crypto.createHash("sha256")
      .update(fs.readFileSync(process.argv[1])).digest("hex"));
  ' "$rollback_manifest")
  [[ "$manifest_digest" == "$expected_digest" ]] || {
    echo "Workflow Skills rollback blocked: manifest digest mismatch" >&2
    exit 78
  }
  authority_id="${KERNEL_RELEASE_ROLLBACK_AUTHORITY_ID:-}"
  claim_id="${KERNEL_RELEASE_ROLLBACK_CLAIM_ID:-}"
  generation="${KERNEL_RELEASE_ROLLBACK_GENERATION:-}"
  [[ "$authority_id" =~ ^[0-9a-fA-F-]{36}$ \
     && "$claim_id" =~ ^[1-9][0-9]*$ \
     && "$generation" == "1" ]] || {
    echo "Workflow Skills rollback blocked: transaction identity unavailable" >&2
    exit 78
  }
  transaction_dir="$deployment_root/logs/release-rollbacks/workflow-skills/transactions/${authority_id}-${claim_id}-${generation}"
  mkdir -p "$transaction_dir"
  chmod 700 "$transaction_dir"
  current_manifest="$transaction_dir/current.links"
  prepared_manifest="$transaction_dir/prepared.links"
  state_file="$transaction_dir/state.json"
  write_rollback_state() {
    phase="$1"
    state_next="${state_file}.next.$$"
    printf '{"phase":"%s","authority_id":"%s","claim_id":%s,"generation":1}\n' \
      "$phase" "$authority_id" "$claim_id" > "$state_next"
    chmod 600 "$state_next"
    mv "$state_next" "$state_file"
  }
  cleanup_rollback_temporaries() {
    [[ -f "$prepared_manifest" ]] || return 0
    while IFS=$'\t' read -r _live temporary_link; do
      [[ -z "${temporary_link:-}" ]] || rm -f "$temporary_link"
    done < "$prepared_manifest"
    rm -f "$prepared_manifest"
  }
  compensate_rollback_links() {
    trap - INT TERM
    write_rollback_state "compensating"
    compensation_failed=0
    while IFS=$'\t' read -r live_skill current_target; do
      if [[ "$current_target" == "absent" ]]; then
        rm -f "$live_skill" || compensation_failed=1
      else
        compensation_link="${live_skill}.rollback-compensate.$$"
        rm -f "$compensation_link"
        if ln -s "$current_target" "$compensation_link"; then
          node -e '
            const fs = require("node:fs");
            fs.renameSync(process.argv[1], process.argv[2]);
          ' "$compensation_link" "$live_skill" || compensation_failed=1
        else
          compensation_failed=1
        fi
        rm -f "$compensation_link"
      fi
    done < "$current_manifest"
    observed_manifest="$transaction_dir/observed.links"
    : > "$observed_manifest"
    while IFS=$'\t' read -r live_skill _current_target; do
      observed_target="$(readlink "$live_skill" 2>/dev/null || echo absent)"
      printf '%s\t%s\n' "$live_skill" "$observed_target" >> "$observed_manifest"
    done < "$current_manifest"
    observed_digest=$(node -e '
      const fs = require("node:fs");
      const crypto = require("node:crypto");
      process.stdout.write("sha256:" + crypto.createHash("sha256")
        .update(fs.readFileSync(process.argv[1])).digest("hex"));
    ' "$observed_manifest")
    rm -f "$observed_manifest"
    cleanup_rollback_temporaries
    if [[ "$compensation_failed" != "0" \
       || "$observed_digest" != "$expected_current_digest" ]]; then
      write_rollback_state "recovery_required"
      echo "Workflow Skills rollback recovery required; journal retained at $transaction_dir" >&2
      return 1
    fi
    write_rollback_state "compensated"
    return 0
  }
  if [[ -f "$state_file" ]] && grep -Eq \
    '"phase":"(applying|compensating|recovery_required)"' "$state_file"; then
    compensate_rollback_links && exit 78
    exit 79
  fi
  : > "$current_manifest"
  : > "$prepared_manifest"
  chmod 600 "$current_manifest" "$prepared_manifest"
  # Validate the complete retained source set before changing any live link.
  # A missing later target must never leave an earlier link partially restored.
  while IFS=$'\t' read -r live_skill prior_target extra; do
    live_parent="$(dirname "$live_skill")"
    [[ "$live_skill" == /* \
       && -n "$prior_target" \
       && -z "$extra" \
       && -d "$live_parent" \
       && -w "$live_parent" \
       && ( ! -e "$live_skill" || -L "$live_skill" ) ]] || {
      rm -rf "$transaction_dir"
      echo "Workflow Skills rollback blocked: unmanaged live path" >&2
      exit 78
    }
    current_target="$(readlink "$live_skill" 2>/dev/null || echo absent)"
    printf '%s\t%s\n' "$live_skill" "$current_target" >> "$current_manifest"
    if [[ "$prior_target" != "absent" ]]; then
      [[ "$prior_target" == /* && -e "$prior_target" ]] || {
        rm -rf "$transaction_dir"
        echo "Workflow Skills rollback blocked: prior target unavailable" >&2
        exit 78
      }
      temporary_link="${live_skill}.rollback-next.$$"
      rm -f "$temporary_link"
      ln -s "$prior_target" "$temporary_link" || {
        rm -rf "$transaction_dir"
        echo "Workflow Skills rollback blocked: target preparation failed" >&2
        exit 78
      }
      printf '%s\t%s\n' "$live_skill" "$temporary_link" >> "$prepared_manifest"
    fi
  done < "$rollback_manifest"
  actual_current_digest=$(node -e '
    const fs = require("node:fs");
    const crypto = require("node:crypto");
    process.stdout.write("sha256:" + crypto.createHash("sha256")
      .update(fs.readFileSync(process.argv[1])).digest("hex"));
  ' "$current_manifest")
  [[ "$actual_current_digest" == "$expected_current_digest" ]] || {
    rm -rf "$transaction_dir"
    echo "Workflow Skills rollback blocked: current production CAS mismatch" >&2
    exit 78
  }
  write_rollback_state "prepared"
  trap 'compensate_rollback_links && exit 78; exit 79' INT TERM
  write_rollback_state "applying"
  while IFS=$'\t' read -r live_skill prior_target; do
    if [[ "$prior_target" == "absent" ]]; then
      rm -f "$live_skill" || {
        compensate_rollback_links && exit 78
        exit 79
      }
    else
      temporary_link="${live_skill}.rollback-next.$$"
      if ! node -e '
        const fs = require("node:fs");
        fs.renameSync(process.argv[1], process.argv[2]);
      ' "$temporary_link" "$live_skill"; then
        compensate_rollback_links && exit 78
        exit 79
      fi
      [[ "$(readlink "$live_skill")" == "$prior_target" ]] || {
        compensate_rollback_links || exit 79
        echo "Workflow Skills rollback blocked: readback mismatch" >&2
        exit 78
      }
    fi
  done < "$rollback_manifest"
  trap - INT TERM
  cleanup_rollback_temporaries
  write_rollback_state "succeeded"
  exit 0
fi

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

# The execution artifact root is temporary. Publish one immutable copy under
# every account before any live link can reference it. A controller replay
# validates and reuses the first published copy.
old_ifs="$IFS"
IFS=':'
for account_root in $deploy_roots; do
  [[ "$account_root" == /* && -d "$account_root" ]] || {
    echo "Workflow Skills production blocked: invalid configured account root" >&2
    exit 78
  }
  releases_root="$account_root/.kernel-releases/workflow-skills"
  persistent_release_root="$releases_root/$release_run_id"
  [[ ! -e "$releases_root" || ( -d "$releases_root" && ! -L "$releases_root" ) ]] || {
    echo "Workflow Skills production blocked: persistent root is unsafe" >&2
    exit 78
  }
  mkdir -p "$releases_root"
  chmod 700 "$releases_root"
  if [[ ! -e "$persistent_release_root" ]]; then
    persistent_temporary="${persistent_release_root}.next.$$"
    rm -rf "$persistent_temporary"
    cp -R "$source_dir" "$persistent_temporary"
    if ! node -e '
      const fs = require("node:fs");
      fs.renameSync(process.argv[1], process.argv[2]);
    ' "$persistent_temporary" "$persistent_release_root" 2>/dev/null; then
      rm -rf "$persistent_temporary"
    fi
  fi
  [[ -d "$persistent_release_root" && ! -L "$persistent_release_root" ]] \
    && diff -qr "$source_dir" "$persistent_release_root" >/dev/null || {
    echo "Workflow Skills production blocked: persistent release mismatch" >&2
    exit 78
  }
  chmod -R a-w "$persistent_release_root"
done
IFS="$old_ifs"

temporary_manifest="${rollback_manifest}.next.$$"
: > "$temporary_manifest"
chmod 600 "$temporary_manifest"

IFS=':'
for account_root in $deploy_roots; do
  skills_root="$account_root/skills"
  persistent_release_root="$account_root/.kernel-releases/workflow-skills/$release_run_id"
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

validate_replay_manifest() {
  [[ -f "$rollback_manifest" && ! -L "$rollback_manifest" ]] || return 1
  node -e '
    const fs = require("node:fs");
    const parse = (path) => fs.readFileSync(path, "utf8").trimEnd()
      .split("\n").filter(Boolean).map((line) => line.split("\t"));
    const retained = parse(process.argv[1]);
    const candidate = parse(process.argv[2]);
    if (
      retained.length !== candidate.length
      || retained.some((row, index) =>
        row.length !== 2
        || !row[0].startsWith("/")
        || !(row[1] === "absent" || row[1].startsWith("/"))
        || row[0] !== candidate[index][0])
    ) process.exit(78);
  ' "$rollback_manifest" "$temporary_manifest"
}

if [[ -e "$rollback_manifest" ]]; then
  validate_replay_manifest || {
    rm -f "$temporary_manifest"
    echo "Workflow Skills production blocked: retained manifest mismatch" >&2
    exit 78
  }
elif ! ln "$temporary_manifest" "$rollback_manifest"; then
  validate_replay_manifest || {
    rm -f "$temporary_manifest"
    echo "Workflow Skills production blocked: retained manifest race mismatch" >&2
    exit 78
  }
fi
rm -f "$temporary_manifest"

previous_digest=$(node -e '
  const fs = require("node:fs");
  const crypto = require("node:crypto");
  const value = fs.readFileSync(process.argv[1]);
  process.stdout.write(crypto.createHash("sha256").update(value).digest("hex"));
' "$rollback_manifest")

IFS=':'
for account_root in $deploy_roots; do
  skills_root="$account_root/skills"
  persistent_release_root="$account_root/.kernel-releases/workflow-skills/$release_run_id"
  for skill_dir in "$source_dir"/*; do
    [[ -d "$skill_dir" && -f "$skill_dir/SKILL.md" ]] || continue
    skill_name="${skill_dir##*/}"
    persistent_skill_dir="$persistent_release_root/$skill_name"
    temporary_link="$skills_root/.${skill_name}.release-next.$$"
    ln -s "$persistent_skill_dir" "$temporary_link"
    node -e '
      const fs = require("node:fs");
      fs.renameSync(process.argv[1], process.argv[2]);
    ' "$temporary_link" "$skills_root/$skill_name"
    [[ "$(readlink "$skills_root/$skill_name")" == "$persistent_skill_dir" ]] || {
      echo "Workflow Skills production blocked: live readback mismatch" >&2
      exit 78
    }
  done
done
IFS="$old_ifs"

current_manifest="${rollback_manifest}.current.$$"
: > "$current_manifest"
chmod 600 "$current_manifest"
while IFS=$'\t' read -r live_skill _prior_target; do
  current_target="$(readlink "$live_skill" 2>/dev/null || echo absent)"
  printf '%s\t%s\n' "$live_skill" "$current_target" >> "$current_manifest"
done < "$rollback_manifest"
current_links_digest=$(node -e '
  const fs = require("node:fs");
  const crypto = require("node:crypto");
  process.stdout.write("sha256:" + crypto.createHash("sha256")
    .update(fs.readFileSync(process.argv[1])).digest("hex"));
' "$current_manifest")
rm -f "$current_manifest"

PREVIOUS_DIGEST="$previous_digest" \
CURRENT_LINKS_DIGEST="$current_links_digest" \
RECEIPT_FILE="$receipt_file" node -e '
  const fs = require("node:fs");
  const artifacts = JSON.parse(process.env.KERNEL_RELEASE_ARTIFACT_VERSIONS || "[]");
  const artifact = artifacts.find((value) => value.name === "workflow-skills");
  if (!artifact || !/^sha256:[0-9a-f]{64}$/.test(artifact.digest || "")) process.exit(78);
  fs.writeFileSync(process.env.RECEIPT_FILE, JSON.stringify({
    anchor: `workflow-skills:${artifact.digest}`,
    current_links_digest: process.env.CURRENT_LINKS_DIGEST,
    previous_version: `workflow-skills:sha256:${process.env.PREVIOUS_DIGEST}`,
    previous_digest: `sha256:${process.env.PREVIOUS_DIGEST}`,
  }), { mode: 0o600 });
  fs.chmodSync(process.env.RECEIPT_FILE, 0o600);
'
