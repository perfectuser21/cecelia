/**
 * Vitest wrapper for check-pipeline-evidence.test.cjs (node --test format).
 * Runs the 7-case unit test suite and validates exit code.
 */

import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { resolve } from 'path'

const TEST_SCRIPT = resolve(__dirname, 'check-pipeline-evidence.test.cjs')

describe('Pipeline Evidence gate (L2 Dynamic Contract)', () => {
  it('7 test cases all pass under node --test', () => {
    let exitCode = 0
    try {
      execSync(`node --test ${TEST_SCRIPT}`, { encoding: 'utf-8', stdio: 'pipe' })
    } catch (error: any) {
      exitCode = error.status || 1
      // Include captured output for debugging on CI
      if (error.stdout) console.log(error.stdout.toString())
      if (error.stderr) console.error(error.stderr.toString())
    }
    expect(exitCode).toBe(0)
  })
})
