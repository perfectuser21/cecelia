import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CI_POLL = join(REPO_ROOT, 'packages/workflows/skills/scripts/ci-poll.sh')

function makeStubGh(dir: string, checksLines: string, mergeState: string): string {
  // stub gh: pr checks → checksLines; pr view → mergeState 纯字符串（模拟 --jq 提取后结果）
  const script = `#!/usr/bin/env bash
if [ "$2" = "checks" ]; then
  printf '%s\\n' '${checksLines.replace(/'/g, "'\\''")}'
elif [ "$2" = "view" ]; then
  echo '${mergeState}'
fi
`
  const p = join(dir, 'gh')
  writeFileSync(p, script)
  chmodSync(p, 0o755)
  return `${dir}:${process.env.PATH}`
}

describe('ci-poll.sh', () => {
  it('CI全绿时应exit 0且stderr含CI_GREEN', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ci-poll-'))
    try {
      const PATH = makeStubGh(tmp, 'ci/build  pass  2m  https://example.com', 'CLEAN')
      const r = spawnSync('bash', [CI_POLL, '123', 'owner/repo'], {
        env: { ...process.env, PATH },
        timeout: 5000,
      })
      expect(r.status).toBe(0)
      expect(r.stderr?.toString()).toContain('CI_GREEN')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('CI有失败时应exit 10', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ci-poll-'))
    try {
      const PATH = makeStubGh(tmp, 'ci/build  fail  2m  https://example.com', 'CLEAN')
      const r = spawnSync('bash', [CI_POLL, '123', 'owner/repo'], {
        env: { ...process.env, PATH },
        timeout: 5000,
      })
      expect(r.status).toBe(10)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('BEHIND时应exit 11', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ci-poll-'))
    try {
      const PATH = makeStubGh(tmp, 'ci/build  pass  2m  https://example.com', 'BEHIND')
      const r = spawnSync('bash', [CI_POLL, '123', 'owner/repo'], {
        env: { ...process.env, PATH },
        timeout: 5000,
      })
      expect(r.status).toBe(11)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
