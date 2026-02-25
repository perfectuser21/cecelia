/**
 * tests/ci/known-failures.test.ts
 *
 * CI known-failures.json schema validation tests
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const KNOWN_FAILURES_PATH = path.join(process.cwd(), 'ci/known-failures.json')

describe('ci/known-failures.json', () => {
  let knownFailures: any

  beforeAll(() => {
    expect(fs.existsSync(KNOWN_FAILURES_PATH)).toBe(true)
    const content = fs.readFileSync(KNOWN_FAILURES_PATH, 'utf-8')
    knownFailures = JSON.parse(content)
  })

  describe('schema validation', () => {
    it('should have required top-level fields', () => {
      expect(knownFailures).toHaveProperty('rules')
      expect(knownFailures).toHaveProperty('allowed')
    })

    it('should have valid rules configuration', () => {
      const { rules } = knownFailures
      expect(typeof rules.max_skip_count).toBe('number')
      expect(rules.max_skip_count).toBeGreaterThan(0)
      expect(typeof rules.require_ticket).toBe('boolean')
    })

    it('should have valid allowed entries structure', () => {
      const { allowed } = knownFailures
      expect(typeof allowed).toBe('object')

      for (const [key, entry] of Object.entries(allowed)) {
        const typedEntry = entry as any
        expect(typedEntry).toHaveProperty('description')
        expect(typeof typedEntry.description).toBe('string')
        expect(typedEntry).toHaveProperty('ticket')
        expect(typeof typedEntry.ticket).toBe('string')
        expect(typedEntry).toHaveProperty('expires')
        expect(typeof typedEntry.expires).toBe('string')
        // Validate expires is a valid date format
        expect(typedEntry.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    })
  })

  describe('content validation', () => {
    it('should not have expired entries', () => {
      const { allowed } = knownFailures
      const now = new Date()

      for (const [key, entry] of Object.entries(allowed)) {
        const typedEntry = entry as any
        const expiresDate = new Date(typedEntry.expires)
        // Allow entries that expire in the future or today
        expect(expiresDate.getTime()).toBeGreaterThanOrEqual(now.setHours(0, 0, 0, 0))
      }
    })

    it('should have allowed count within max_skip_count', () => {
      const { rules, allowed } = knownFailures
      const allowedCount = Object.keys(allowed).length
      expect(allowedCount).toBeLessThanOrEqual(rules.max_skip_count)
    })
  })
})
