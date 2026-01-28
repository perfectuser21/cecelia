/**
 * Media Data API Routes
 * Proxies to social-metrics-api
 */

import { Router } from 'express';

const router = Router();

// Social metrics API base URL
const SOCIAL_METRICS_API = process.env.SOCIAL_METRICS_API || 'http://social-metrics-api:3000';

// GET /api/media/platform-data - Get all platform content data
router.get('/platform-data', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query as Record<string, string>);
    const response = await fetch(`${SOCIAL_METRICS_API}/api/platform-data?${params}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching platform data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch platform data' });
  }
});

// GET /api/media/platform-data/stats - Get stats
router.get('/platform-data/stats', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query as Record<string, string>);
    const response = await fetch(`${SOCIAL_METRICS_API}/api/platform-data/stats?${params}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// GET /api/media/platform-data/grouped - Get grouped data
router.get('/platform-data/grouped', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query as Record<string, string>);
    const response = await fetch(`${SOCIAL_METRICS_API}/api/platform-data/grouped?${params}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching grouped data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch grouped data' });
  }
});

// GET /api/media/platform-data/:id/metrics - Get content metrics
router.get('/platform-data/:id/metrics', async (req, res) => {
  try {
    const { id } = req.params;
    const response = await fetch(`${SOCIAL_METRICS_API}/api/platform-data/${id}/metrics`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch metrics' });
  }
});

// GET /api/media/raw-scraping-data - Get raw scraping data
router.get('/raw-scraping-data', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query as Record<string, string>);
    const response = await fetch(`${SOCIAL_METRICS_API}/api/platform-data/raw-scraping?${params}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching raw scraping data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch raw scraping data' });
  }
});

export default router;
