# Coverage Baseline Report

## Date: 2026-02-16

## Target Files Coverage

### thalamus.js
- **Lines**: 72% (Target: 95%)
- **Branches**: 95% ✅
- **Functions**: 50% (Target: 95%)
- **Statements**: 72% (Target: 95%)
- **Uncovered Lines**: 117-425, 516-540

### cortex.js
- **Lines**: 49.2% (Target: 95%)
- **Branches**: 42.85% (Target: 95%)
- **Functions**: 27.27% (Target: 95%)
- **Statements**: 49.2% (Target: 95%)
- **Uncovered Lines**: 57-762, 787-794

## Overall Project Coverage
- **Lines**: 46.35%
- **Branches**: 79.25%
- **Functions**: 36.22%
- **Statements**: 46.35%

## Gap Analysis

### thalamus.js Gaps
- Need to increase line coverage by 23 percentage points
- Need to increase function coverage by 45 percentage points
- Branches already meet threshold ✅

### cortex.js Gaps
- Need to increase line coverage by 45.8 percentage points
- Need to increase branch coverage by 52.15 percentage points
- Need to increase function coverage by 67.73 percentage points

## Next Steps
1. Write comprehensive tests for uncovered lines in thalamus.js (117-425, 516-540)
2. Write comprehensive tests for uncovered lines in cortex.js (57-762, 787-794)
3. Focus on testing all functions in both files
4. Ensure all decision branches are covered in cortex.js

## Test Coverage Command
```bash
npm run test:coverage
```

## Coverage Reports Location
- HTML Report: `brain/coverage/index.html`
- LCOV Report: `brain/coverage/lcov.info`
- JSON Report: `brain/coverage/coverage-final.json`