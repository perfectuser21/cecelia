/**
 * Tests for Bottleneck Scan to cecelia_events
 *
 * Verifies that bottleneck scan results are written to cecelia_events table.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import pool from '../db.js';
import { triggerBottleneckScan } from '../triggers/bottleneck-scan.js';

describe('bottleneck-scan events', () => {
  beforeEach(async () => {
    // Clean up test events
    await pool.query(`DELETE FROM cecelia_events WHERE source = 'brain_bottleneck_scanner'`);
    // Clean up test scans
    await pool.query(`DELETE FROM bottleneck_scans WHERE bottleneck_type LIKE 'test_%'`);
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM cecelia_events WHERE source = 'brain_bottleneck_scanner'`);
    await pool.query(`DELETE FROM bottleneck_scans WHERE bottleneck_type LIKE 'test_%'`);
  });

  describe('triggerBottleneckScan', () => {
    it('should write scan results to cecelia_events table', async () => {
      // Execute scan with immediate trigger (0 interval)
      const result = await triggerBottleneckScan(pool, {
        intervalMs: 0,
        lastScanTime: 0,
      });

      // Verify scan completed
      expect(result.scans).toBeDefined();
      expect(result.scans.length).toBeGreaterThan(0);

      // Verify cecelia_events record exists
      const eventCheck = await pool.query(
        `SELECT * FROM cecelia_events
         WHERE event_type = 'bottleneck_scan' AND source = 'brain_bottleneck_scanner'
         ORDER BY created_at DESC LIMIT 1`
      );

      expect(eventCheck.rows.length).toBe(1);

      const event = eventCheck.rows[0];
      const payload = JSON.parse(event.payload);

      // Verify payload structure
      expect(payload.scan_type).toBe('batch_scan');
      expect(payload.severity_counts).toBeDefined();
      expect(payload.scanned_at).toBeDefined();
      expect(payload.scans).toBeDefined();
      expect(Array.isArray(payload.scans)).toBe(true);

      // Verify scan details in payload
      for (const scan of payload.scans) {
        expect(scan.scan_type).toBeDefined();
        expect(scan.bottleneck_area).toBeDefined();
        expect(scan.severity).toBeDefined();
      }
    });

    it('should not write to cecelia_events when no scans executed', async () => {
      // Execute scan with long interval (skip)
      const result = await triggerBottleneckScan(pool, {
        intervalMs: 3600000, // 1 hour
        lastScanTime: Date.now() - 1000, // 1 second ago
      });

      // Should be skipped
      expect(result.skipped).toBe(true);

      // Verify no cecelia_events record
      const eventCheck = await pool.query(
        `SELECT * FROM cecelia_events
         WHERE event_type = 'bottleneck_scan' AND source = 'brain_bottleneck_scanner'`
      );

      expect(eventCheck.rows.length).toBe(0);
    });

    it('should include severity counts in payload', async () => {
      // Execute scan
      await triggerBottleneckScan(pool, {
        intervalMs: 0,
        lastScanTime: 0,
      });

      // Get the event
      const eventCheck = await pool.query(
        `SELECT payload FROM cecelia_events
         WHERE event_type = 'bottleneck_scan' AND source = 'brain_bottleneck_scanner'
         ORDER BY created_at DESC LIMIT 1`
      );

      const payload = JSON.parse(eventCheck.rows[0].payload);

      // Verify severity_counts structure
      expect(payload.severity_counts).toHaveProperty('critical');
      expect(payload.severity_counts).toHaveProperty('high');
      expect(payload.severity_counts).toHaveProperty('medium');
      expect(payload.severity_counts).toHaveProperty('low');
      expect(typeof payload.severity_counts.critical).toBe('number');
      expect(typeof payload.severity_counts.high).toBe('number');
      expect(typeof payload.severity_counts.medium).toBe('number');
      expect(typeof payload.severity_counts.low).toBe('number');
    });
  });
});
