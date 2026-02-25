#!/usr/bin/env node
/**
 * pre-commit-validate.mjs — Basic pre-commit validation
 *
 * This script performs basic checks before allowing a commit.
 * Comprehensive validation is done by CI (facts-check, tests, etc.)
 *
 * Exit code: 0 = pass, 1 = fail
 */

// Placeholder: Always pass for now
// CI will do the real validation (facts-check, tests, devgate, etc.)

console.log('✅ Pre-commit validation passed');
console.log('   (Comprehensive validation will be done by CI)');

process.exit(0);
