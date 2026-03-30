import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Use resolve(__dirname, ...) directly so check-changed-coverage.cjs can trace file references
const STOP_DEV_SH = resolve(__dirname, '../../hooks/stop-dev.sh')
const PR_REVIEW_YML = resolve(__dirname, '../../../../.github/workflows/pr-review.yml')

describe('pr-review.yml fail-closed behavior', () => {
  const yml = readFileSync(PR_REVIEW_YML, 'utf8')

  it('contains MAX_RETRY and RETRY_COUNT for retry loop', () => {
    expect(yml).toContain('MAX_RETRY')
    expect(yml).toContain('RETRY_COUNT')
  })

  it('contains API_ERROR flag for fail-closed detection', () => {
    expect(yml).toContain('API_ERROR')
  })

  it('exits with code 1 when all retries fail (fail-closed)', () => {
    expect(yml).toContain('exit 1')
    // API_ERROR=true must appear before exit 1
    const apiErrorIdx = yml.indexOf('API_ERROR=true')
    const exit1Idx = yml.indexOf('exit 1')
    expect(apiErrorIdx).toBeGreaterThan(-1)
    expect(exit1Idx).toBeGreaterThan(apiErrorIdx)
  })
})

describe('stop-dev.sh orphan fail-closed behavior', () => {
  const sh = readFileSync(STOP_DEV_SH, 'utf8')

  it('does not have exit 0 adjacent to _ORPHAN_COUNT (orphan path must always block)', () => {
    const lines = sh.split('\n')
    const hasOrphanExit0 = lines.some((line, i) => {
      if (!line.includes('exit 0')) return false
      const context = lines.slice(Math.max(0, i - 5), i + 6).join(' ')
      return context.includes('_ORPHAN_COUNT')
    })
    expect(hasOrphanExit0).toBe(false)
  })

  it('orphan path always exits with code 2 (fail-closed, no count limit)', () => {
    // After the orphan detection block, exit 2 must follow
    const orphanIdx = sh.indexOf('.dev-lock 存在但 .dev-mode 缺失')
    expect(orphanIdx).toBeGreaterThan(-1)
    const afterOrphan = sh.slice(orphanIdx, orphanIdx + 500)
    expect(afterOrphan).toContain('exit 2')
    expect(afterOrphan).not.toContain('exit 0')
  })
})
