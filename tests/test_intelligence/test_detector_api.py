"""Tests for /detector API endpoints."""

import pytest
from fastapi.testclient import TestClient

from src.api.main import app


@pytest.fixture
def client():
    """Create test client."""
    with TestClient(app) as c:
        yield c


class TestDetectorAPI:
    """Test suite for /detector API endpoints."""

    def test_detector_status(self, client):
        """Test getting detector status."""
        response = client.get("/detector/status")
        assert response.status_code == 200
        data = response.json()
        assert "running" in data
        assert "monitors" in data
        assert "total_events" in data
        assert "check_interval_seconds" in data

    def test_detector_status_has_monitors(self, client):
        """Test that status includes all monitors."""
        response = client.get("/detector/status")
        assert response.status_code == 200
        data = response.json()
        monitors = data["monitors"]
        assert "ci" in monitors
        assert "code" in monitors
        assert "security" in monitors

    def test_detector_monitor_status_fields(self, client):
        """Test monitor status has required fields."""
        response = client.get("/detector/status")
        assert response.status_code == 200
        data = response.json()

        for name, monitor in data["monitors"].items():
            assert "name" in monitor
            assert "enabled" in monitor
            assert "events_detected" in monitor

    def test_detector_events_empty(self, client):
        """Test getting events when none exist."""
        response = client.get("/detector/events")
        assert response.status_code == 200
        data = response.json()
        assert "events" in data
        assert "total" in data
        assert isinstance(data["events"], list)

    def test_detector_events_with_limit(self, client):
        """Test getting events with limit parameter."""
        response = client.get("/detector/events?limit=10")
        assert response.status_code == 200
        data = response.json()
        assert len(data["events"]) <= 10

    def test_detector_events_filter_by_type(self, client):
        """Test filtering events by type."""
        response = client.get("/detector/events?event_type=ci_failure")
        assert response.status_code == 200
        data = response.json()
        # All returned events should be ci_failure type
        for event in data["events"]:
            assert event["event_type"] == "ci_failure"

    def test_detector_events_filter_by_severity(self, client):
        """Test filtering events by severity."""
        response = client.get("/detector/events?severity=critical")
        assert response.status_code == 200
        data = response.json()
        # All returned events should be critical severity
        for event in data["events"]:
            assert event["severity"] == "critical"

    def test_detector_status_check_interval(self, client):
        """Test that check interval is returned."""
        response = client.get("/detector/status")
        assert response.status_code == 200
        data = response.json()
        assert data["check_interval_seconds"] == 300  # Default 5 minutes
