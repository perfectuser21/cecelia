"""Tests for Detector components."""

from datetime import datetime

from src.intelligence.detector.base_monitor import (
    BaseMonitor,
    EventSeverity,
    EventType,
    MonitorEvent,
)
from src.intelligence.detector.ci_monitor import CIMonitor
from src.intelligence.detector.code_monitor import CodeMonitor
from src.intelligence.detector.security_monitor import SecurityMonitor
from src.intelligence.detector.detector_service import DetectorService


class TestMonitorEvent:
    """Test suite for MonitorEvent."""

    def test_event_creation(self):
        """Test creating a monitor event."""
        event = MonitorEvent(
            event_type=EventType.CI_FAILURE,
            severity=EventSeverity.HIGH,
            title="CI Failed",
            description="Build failed on main",
            source="ci_monitor",
        )
        assert event.event_type == EventType.CI_FAILURE
        assert event.severity == EventSeverity.HIGH
        assert event.title == "CI Failed"
        assert event.event_id is not None

    def test_event_to_dict(self):
        """Test converting event to dictionary."""
        event = MonitorEvent(
            event_type=EventType.CI_FAILURE,
            severity=EventSeverity.HIGH,
            title="CI Failed",
            description="Build failed",
            source="ci_monitor",
        )
        d = event.to_dict()
        assert d["event_type"] == "ci_failure"
        assert d["severity"] == "high"
        assert "timestamp" in d

    def test_event_to_task(self):
        """Test converting event to task."""
        event = MonitorEvent(
            event_type=EventType.CI_FAILURE,
            severity=EventSeverity.CRITICAL,
            title="CI Failed",
            description="Build failed",
            source="ci_monitor",
        )
        task = event.to_task()
        assert task["priority"] == "P0"
        assert "auto-created" in task["tags"]
        assert "ci_failure" in task["tags"]


class TestCIMonitor:
    """Test suite for CIMonitor."""

    def setup_method(self):
        """Set up test fixtures."""
        self.monitor = CIMonitor(enabled=True)

    def test_monitor_initialization(self):
        """Test monitor initializes correctly."""
        assert self.monitor.name == "ci_monitor"
        assert self.monitor.enabled is True

    def test_get_status(self):
        """Test getting monitor status."""
        status = self.monitor.get_status()
        assert status["name"] == "ci_monitor"
        assert status["enabled"] is True
        assert status["events_detected"] == 0

    def test_check_sync_with_failure(self):
        """Test detecting CI failures."""
        runs = [
            {
                "run_id": 123,
                "workflow_name": "CI",
                "branch": "main",
                "status": "completed",
                "conclusion": "failure",
                "error_message": "Test failed",
                "html_url": "https://github.com/test/repo/actions/runs/123",
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
                "head_sha": "abc123",
                "repository": "test/repo",
            }
        ]
        events = self.monitor.check_sync(runs)
        assert len(events) == 1
        assert events[0].event_type == EventType.CI_FAILURE
        assert events[0].severity == EventSeverity.HIGH
        assert "CI 失败" in events[0].title

    def test_check_sync_skips_success(self):
        """Test that successful runs are skipped."""
        runs = [
            {
                "run_id": 124,
                "workflow_name": "CI",
                "branch": "main",
                "status": "completed",
                "conclusion": "success",
                "error_message": None,
                "html_url": "https://github.com/test/repo/actions/runs/124",
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
                "head_sha": "def456",
                "repository": "test/repo",
            }
        ]
        events = self.monitor.check_sync(runs)
        assert len(events) == 0

    def test_no_duplicate_events(self):
        """Test that duplicate events are not created."""
        runs = [
            {
                "run_id": 125,
                "workflow_name": "CI",
                "branch": "main",
                "status": "completed",
                "conclusion": "failure",
                "error_message": "Error",
                "repository": "test/repo",
            }
        ]
        # First check
        events1 = self.monitor.check_sync(runs)
        assert len(events1) == 1

        # Second check with same run
        events2 = self.monitor.check_sync(runs)
        assert len(events2) == 0

    def test_event_metadata(self):
        """Test that event metadata is correct."""
        runs = [
            {
                "run_id": 126,
                "workflow_name": "Build",
                "branch": "feature/test",
                "status": "completed",
                "conclusion": "failure",
                "error_message": "Compile error",
                "html_url": "https://github.com/test/repo/actions/runs/126",
                "head_sha": "ghi789",
                "repository": "test/repo",
            }
        ]
        events = self.monitor.check_sync(runs)
        assert events[0].metadata["workflow"] == "Build"
        assert events[0].metadata["branch"] == "feature/test"
        assert events[0].metadata["run_id"] == 126


class TestCodeMonitor:
    """Test suite for CodeMonitor."""

    def setup_method(self):
        """Set up test fixtures."""
        self.monitor = CodeMonitor(enabled=True)

    def test_monitor_initialization(self):
        """Test monitor initializes correctly."""
        assert self.monitor.name == "code_monitor"
        assert self.monitor.enabled is True

    def test_check_sync_with_commits(self):
        """Test detecting commits."""
        commits = [
            {
                "sha": "abc123def456",
                "message": "feat: add new feature",
                "author": "developer",
                "timestamp": datetime.utcnow(),
                "branch": "main",
                "files_changed": ["src/test.py"],
                "additions": 50,
                "deletions": 10,
                "repository": "test/repo",
            }
        ]
        events = self.monitor.check_sync(commits)
        assert len(events) == 1
        assert events[0].event_type == EventType.CODE_PUSH
        assert "新提交" in events[0].title

    def test_severity_based_on_changes(self):
        """Test severity is based on change size."""
        # Small change
        small_commits = [
            {
                "sha": "small123",
                "message": "fix: typo",
                "author": "dev",
                "branch": "main",
                "files_changed": ["README.md"],
                "additions": 5,
                "deletions": 2,
                "repository": "test/repo",
            }
        ]
        events = self.monitor.check_sync(small_commits)
        assert events[0].severity == EventSeverity.INFO

        # Large change
        large_commits = [
            {
                "sha": "large456",
                "message": "refactor: major changes",
                "author": "dev",
                "branch": "main",
                "files_changed": ["src/big.py"],
                "additions": 600,
                "deletions": 200,
                "repository": "test/repo",
            }
        ]
        events = self.monitor.check_sync(large_commits)
        assert events[0].severity == EventSeverity.MEDIUM

    def test_event_metadata_contains_files(self):
        """Test that event metadata contains file changes."""
        commits = [
            {
                "sha": "meta123",
                "message": "update",
                "author": "dev",
                "branch": "develop",
                "files_changed": ["src/a.py", "src/b.py"],
                "additions": 20,
                "deletions": 5,
                "repository": "test/repo",
            }
        ]
        events = self.monitor.check_sync(commits)
        assert events[0].metadata["files_changed"] == ["src/a.py", "src/b.py"]
        assert events[0].metadata["additions"] == 20
        assert events[0].metadata["deletions"] == 5


class TestSecurityMonitor:
    """Test suite for SecurityMonitor."""

    def setup_method(self):
        """Set up test fixtures."""
        self.monitor = SecurityMonitor(enabled=True)

    def test_monitor_initialization(self):
        """Test monitor initializes correctly."""
        assert self.monitor.name == "security_monitor"
        assert self.monitor.enabled is True

    def test_check_sync_with_vulnerability(self):
        """Test detecting security vulnerabilities."""
        alerts = [
            {
                "alert_id": 1,
                "package_name": "lodash",
                "vulnerable_version": "< 4.17.21",
                "patched_version": "4.17.21",
                "severity": "high",
                "summary": "Prototype Pollution",
                "description": "Lodash versions prior to 4.17.21 are vulnerable",
                "cve_id": "CVE-2021-23337",
                "created_at": datetime.utcnow(),
                "html_url": "https://github.com/advisories/GHSA-xxx",
                "state": "open",
                "repository": "test/repo",
            }
        ]
        events = self.monitor.check_sync(alerts)
        assert len(events) == 1
        assert events[0].event_type == EventType.SECURITY_VULN
        assert events[0].severity == EventSeverity.HIGH
        assert "安全漏洞" in events[0].title

    def test_severity_mapping(self):
        """Test severity is correctly mapped."""
        critical_alert = [
            {
                "alert_id": 2,
                "package_name": "critical-pkg",
                "vulnerable_version": "1.0.0",
                "patched_version": "1.0.1",
                "severity": "critical",
                "summary": "Critical bug",
                "description": "Critical vulnerability",
                "state": "open",
                "repository": "test/repo",
            }
        ]
        events = self.monitor.check_sync(critical_alert)
        assert events[0].severity == EventSeverity.CRITICAL

    def test_skips_fixed_alerts(self):
        """Test that fixed alerts are skipped."""
        alerts = [
            {
                "alert_id": 3,
                "package_name": "fixed-pkg",
                "vulnerable_version": "1.0.0",
                "patched_version": "1.0.1",
                "severity": "high",
                "summary": "Fixed bug",
                "description": "Already fixed",
                "state": "fixed",
                "repository": "test/repo",
            }
        ]
        events = self.monitor.check_sync(alerts)
        assert len(events) == 0

    def test_event_metadata_contains_package_info(self):
        """Test that event metadata contains package information."""
        alerts = [
            {
                "alert_id": 4,
                "package_name": "vulnerable-lib",
                "vulnerable_version": "< 2.0.0",
                "patched_version": "2.0.0",
                "severity": "medium",
                "summary": "Security issue",
                "description": "Description",
                "cve_id": "CVE-2023-12345",
                "state": "open",
                "repository": "test/repo",
                "html_url": "https://example.com",
            }
        ]
        events = self.monitor.check_sync(alerts)
        assert events[0].metadata["package_name"] == "vulnerable-lib"
        assert events[0].metadata["cve_id"] == "CVE-2023-12345"
        assert events[0].metadata["patched_version"] == "2.0.0"


class TestDetectorService:
    """Test suite for DetectorService."""

    def setup_method(self):
        """Set up test fixtures."""
        self.ci_monitor = CIMonitor(enabled=True)
        self.code_monitor = CodeMonitor(enabled=True)
        self.security_monitor = SecurityMonitor(enabled=True)
        self.service = DetectorService(
            ci_monitor=self.ci_monitor,
            code_monitor=self.code_monitor,
            security_monitor=self.security_monitor,
            check_interval=60,
        )

    def test_service_initialization(self):
        """Test service initializes correctly."""
        status = self.service.get_status()
        assert status.running is False
        assert "ci" in status.monitors
        assert "code" in status.monitors
        assert "security" in status.monitors

    def test_add_remove_monitor(self):
        """Test adding and removing monitors."""
        class CustomMonitor(BaseMonitor):
            async def check(self):
                return []

        custom = CustomMonitor(name="custom")
        self.service.add_monitor("custom", custom)

        status = self.service.get_status()
        assert "custom" in status.monitors

        self.service.remove_monitor("custom")
        status = self.service.get_status()
        assert "custom" not in status.monitors

    def test_get_recent_events(self):
        """Test getting recent events."""
        # Add some events via CI monitor
        runs = [
            {
                "run_id": 200,
                "workflow_name": "CI",
                "branch": "main",
                "conclusion": "failure",
                "repository": "test/repo",
            }
        ]
        self.ci_monitor.check_sync(runs)

        # Get events through service
        # Note: events are stored in monitor, not service directly in sync mode
        monitor_events = self.ci_monitor.get_recent_events()
        assert len(monitor_events) == 1

    def test_to_dict(self):
        """Test converting service to dictionary."""
        d = self.service.to_dict()
        assert "running" in d
        assert "monitors" in d
        assert "total_events" in d
        assert "check_interval_seconds" in d

    def test_clear_events(self):
        """Test clearing all events."""
        # Add events
        runs = [{"run_id": 300, "conclusion": "failure", "repository": "test/repo"}]
        self.ci_monitor.check_sync(runs)

        # Clear
        self.service.clear_events()

        # Check cleared
        assert len(self.ci_monitor.get_recent_events()) == 0
