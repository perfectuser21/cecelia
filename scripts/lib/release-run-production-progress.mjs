import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
} from 'node:fs';
import { join } from 'node:path';

import { digestTree } from './release-run-tree-digest.mjs';

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

function artifactIdentityMatches(receiptArtifact, artifact) {
  return receiptArtifact?.name === artifact.name
    && receiptArtifact?.version === artifact.version
    && receiptArtifact?.digest === artifact.digest;
}

function readWorkflowCurrentDigest(manifestPath) {
  const lines = [];
  for (const line of readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean)) {
    const [liveSkill, _priorTarget, ...extra] = line.split('\t');
    if (!liveSkill?.startsWith('/') || extra.length > 0) return null;
    if (!existsSync(liveSkill) || !lstatSync(liveSkill).isSymbolicLink()) return null;
    lines.push(`${liveSkill}\t${readlinkSync(liveSkill)}\n`);
  }
  return `sha256:${createHash('sha256').update(lines.join('')).digest('hex')}`;
}

export async function isProductionRouteComplete({
  route,
  artifact,
  repoRoot,
  releaseRunId,
  mergeSha,
  skillsDeployRoots = '',
  workflowSourceRoot,
  inspectBrainDeployment,
  brainReceiptPath,
}) {
  if (
    !route?.artifact
    || artifact?.name !== route.artifact
    || !DIGEST_RE.test(artifact?.digest ?? '')
    || !repoRoot?.startsWith('/')
    || !/^[0-9a-f-]{36}$/i.test(releaseRunId ?? '')
    || !/^[0-9a-f]{40}$/.test(mergeSha ?? '')
  ) {
    return false;
  }
  if (route.artifact === 'brain') {
    if (typeof inspectBrainDeployment !== 'function') return false;
    try {
      const receipt = JSON.parse(readFileSync(
        brainReceiptPath ?? join(repoRoot, 'logs/cecelia-deploy-status.json'),
        'utf8',
      ));
      const deployedArtifact = receipt.deployed_artifact_versions?.find(
        (item) => item?.name === 'brain',
      );
      if (
        receipt.status !== 'success'
        || receipt.release_run_id !== releaseRunId
        || receipt.merge_sha !== mergeSha
        || !artifactIdentityMatches(deployedArtifact, artifact)
        || !DIGEST_RE.test(receipt.deployed_image_digest ?? '')
      ) {
        return false;
      }
      const observed = await inspectBrainDeployment();
      return observed?.running === true
        && observed?.gitSha === mergeSha
        && observed?.imageDigest === receipt.deployed_image_digest;
    } catch {
      return false;
    }
  }
  if (route.artifact === 'workspace') {
    try {
      const release = readFileSync(join(repoRoot, '.production-release'), 'utf8');
      const receipt = JSON.parse(readFileSync(join(
        repoRoot,
        'logs/release-rollbacks/dashboard',
        `${releaseRunId}.json`,
      ), 'utf8'));
      return receipt.schema_version === 1
        && receipt.release_run_id === releaseRunId
        && receipt.merge_sha === mergeSha
        && receipt.artifact_name === 'workspace'
        && receipt.current_version === artifact.version
        && receipt.current_digest === artifact.digest
        && receipt.anchor === `workspace:${artifact.digest}`
        && DIGEST_RE.test(receipt.current_deployed_digest ?? '')
        && digestTree(join(repoRoot, 'apps/dashboard/dist'))
          === receipt.current_deployed_digest
        && release.match(/^commit=([0-9a-f]{40})$/m)?.[1] === mergeSha
        && release.match(/^current=(prod-cecelia-v[0-9]+)$/m)?.[1]
          === receipt.new_tag;
    } catch {
      return false;
    }
  }
  if (route.artifact === 'workflow-skills') {
    try {
      const rollbackRoot = join(
        repoRoot,
        'logs/release-rollbacks/workflow-skills',
      );
      const receipt = JSON.parse(readFileSync(
        join(rollbackRoot, `${releaseRunId}.json`),
        'utf8',
      ));
      if (
        receipt.anchor !== `workflow-skills:${artifact.digest}`
        || !DIGEST_RE.test(receipt.current_links_digest ?? '')
        || readWorkflowCurrentDigest(join(rollbackRoot, `${releaseRunId}.links`))
          !== receipt.current_links_digest
      ) {
        return false;
      }
      const roots = String(skillsDeployRoots).split(':').filter(Boolean);
      return roots.length > 0 && roots.every((accountRoot) => {
        const persistentRoot = join(
          accountRoot,
          '.kernel-releases/workflow-skills',
          releaseRunId,
        );
        return existsSync(workflowSourceRoot)
          && existsSync(persistentRoot)
          && !lstatSync(persistentRoot).isSymbolicLink()
          && digestTree(persistentRoot) === digestTree(workflowSourceRoot);
      });
    } catch {
      return false;
    }
  }
  return false;
}

export const __test__ = {
  DIGEST_RE,
  artifactIdentityMatches,
  readWorkflowCurrentDigest,
};
