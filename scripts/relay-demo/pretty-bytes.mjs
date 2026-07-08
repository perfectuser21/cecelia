#!/usr/bin/env node

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

function formatBytes(input) {
  const value = Number(input);

  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Expected a non-negative byte count');
  }

  if (value === 0) {
    return '0 B';
  }

  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < UNITS.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const wholeOrDecimal = Number.isInteger(size) ? String(size) : size.toFixed(1).replace(/\.0$/, '');
  return `${wholeOrDecimal} ${UNITS[unitIndex]}`;
}

process.stdout.write(`${formatBytes(process.argv[2])}\n`);
