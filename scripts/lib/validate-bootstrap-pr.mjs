import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateBootstrapPrFacts(value, expected) {
  const facts = {
    repository: value?.base?.repo?.full_name ?? '',
    state: value?.state ?? '',
    merged: value?.merged === true,
    sourceHeadSha: value?.head?.sha ?? '',
    mergeSha: value?.merge_commit_sha ?? '',
    baseRef: value?.base?.ref ?? '',
  };
  if (
    facts.repository !== expected.repository
    || facts.state !== 'closed'
    || facts.merged !== true
    || facts.sourceHeadSha !== expected.sourceHeadSha
    || facts.mergeSha !== expected.mergeSha
    || facts.baseRef !== 'main'
  ) {
    throw new Error('github_pr_facts_mismatch');
  }
  return facts;
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [repository, sourceHeadSha, mergeSha] = process.argv.slice(2);
    const value = JSON.parse(readFileSync(0, 'utf8'));
    const facts = validateBootstrapPrFacts(value, {
      repository,
      sourceHeadSha,
      mergeSha,
    });
    process.stdout.write([
      facts.state,
      facts.merged ? 'true' : 'false',
      facts.sourceHeadSha,
      facts.mergeSha,
      facts.baseRef,
    ].join('\t'));
  } catch {
    process.exitCode = 1;
  }
}
