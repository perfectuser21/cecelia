#!/usr/bin/env node

function slugify(input) {
  const value = String(input ?? '');

  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

process.stdout.write(`${slugify(process.argv[2])}\n`);
