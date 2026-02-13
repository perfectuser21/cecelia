/**
 * Test utilities for Cecelia Brain
 * @module test-utils
 */

/**
 * Format a Date object to "YYYY-MM-DD HH:mm:ss" string in Asia/Shanghai timezone
 *
 * @param {Date} date - The date to format
 * @returns {string} Formatted timestamp string
 *
 * @example
 * const now = new Date();
 * const formatted = formatTimestamp(now);
 * // Returns: "2026-02-13 12:36:45"
 */
export function formatTimestamp(date) {
  return date.toLocaleString('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(',', '');
}
