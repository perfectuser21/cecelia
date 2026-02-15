# Test Coverage Guide

## Overview
This guide documents the test coverage configuration and best practices for the Cecelia Brain project, with special focus on achieving 95% coverage for the Thalamus decision engine.

## Configuration

### Vitest Coverage Configuration
Coverage is configured in `brain/vitest.config.js`:

```javascript
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov', 'html', 'json'],
  reportsDirectory: './coverage',
  thresholds: {
    statements: 95,
    branches: 95,
    functions: 95,
    lines: 95
  }
}
```

## Running Coverage

### Local Development

```bash
# Run tests with coverage
cd brain
npm run test:coverage

# Run tests with coverage in watch mode
npm run test:coverage:watch
```

### Viewing Coverage Reports

1. **Terminal Report**: Displayed automatically when running coverage
2. **HTML Report**: Open `brain/coverage/index.html` in a browser
3. **JSON Report**: Available at `brain/coverage/coverage-final.json`
4. **LCOV Report**: Available at `brain/coverage/lcov.info`

## Target Files

### Priority Files (95% Coverage Target)
- `src/thalamus.js` - Thalamus decision engine
- `src/cortex.js` - Cortex advanced analysis

### Current Baseline (2026-02-16)

| File | Lines | Branches | Functions |
|------|-------|----------|-----------|
| thalamus.js | 72% | 95% | 50% |
| cortex.js | 49.2% | 42.85% | 27.27% |

## CI/CD Integration

### GitHub Actions
Coverage checks run automatically on every PR:

1. Tests run with coverage collection
2. Coverage reports are generated
3. Thalamus/Cortex coverage is specifically tracked
4. (Future) PR fails if coverage drops below 95%

### Coverage Badge
The README displays a live coverage badge showing current coverage percentage.

## Best Practices

### Writing Tests for Coverage

1. **Test all functions**: Ensure every exported function has tests
2. **Cover edge cases**: Test boundary conditions and error paths
3. **Test branches**: Ensure all if/else branches are covered
4. **Mock dependencies**: Use vitest mocks for external dependencies

### Example Test Structure

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { functionToTest } from '../src/module.js'

describe('Module Name', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('functionToTest', () => {
    it('should handle normal case', async () => {
      const result = await functionToTest('input')
      expect(result).toBe('expected')
    })

    it('should handle error case', async () => {
      await expect(functionToTest(null)).rejects.toThrow()
    })

    it('should cover all branches', async () => {
      // Test each conditional branch
    })
  })
})
```

## Improving Coverage

### Step-by-Step Process

1. **Identify gaps**: Run coverage and check uncovered lines
2. **Prioritize**: Focus on critical business logic first
3. **Write tests**: Add tests for uncovered scenarios
4. **Verify**: Run coverage again to confirm improvement

### Tools and Commands

```bash
# See specific file coverage
npm run test:coverage -- src/thalamus.js

# Generate detailed report
npm run test:coverage

# Find untested files
grep "0%" coverage/coverage-final.json
```

## Coverage Thresholds

### Global Thresholds (Target)
- Statements: 95%
- Branches: 95%
- Functions: 95%
- Lines: 95%

### Enforcement Strategy
1. **Phase 1** (Current): Baseline measurement and tracking
2. **Phase 2**: Gradual improvement toward 95%
3. **Phase 3**: Enforce 95% threshold in CI

## Troubleshooting

### Common Issues

1. **Coverage not generating**: Ensure @vitest/coverage-v8 is installed
2. **Tests timing out**: Increase timeout in vitest.config.js
3. **Mocking issues**: Use vi.mock() at module level

### Debug Commands

```bash
# Verbose output
npx vitest run --coverage --reporter=verbose

# Single file test
npx vitest run src/__tests__/thalamus.test.js --coverage

# Clear cache
rm -rf coverage node_modules/.vitest
```

## Resources

- [Vitest Coverage Documentation](https://vitest.dev/guide/coverage)
- [V8 Coverage Provider](https://github.com/vitest-dev/vitest/tree/main/packages/coverage-v8)
- [Writing Effective Tests](https://vitest.dev/guide/testing-types)