/**
 * Vitest wrapper for devgate-fake-test-detection.test.cjs
 * Runs the standalone CommonJS test script and validates its results
 */

import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { resolve } from 'path'

const SCRIPT_PATH = resolve(__dirname, 'devgate-fake-test-detection.test.cjs')

describe('DevGate fake test detection', () => {
  it('should pass all assertion tests when run as standalone script', () => {
    // Run the script and capture exit code
    let exitCode = 0
    try {
      execSync(`node ${SCRIPT_PATH}`, { encoding: 'utf-8', stdio: 'pipe' })
    } catch (error: any) {
      exitCode = error.status || 1
    }

    expect(exitCode).toBe(0)
  })
})
