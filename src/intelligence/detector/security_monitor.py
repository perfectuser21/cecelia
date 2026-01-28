"""Security Monitor - Monitor security vulnerabilities and alerts."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Protocol

from src.intelligence.detector.base_monitor import (
    BaseMonitor,
    EventSeverity,
    EventType,
    MonitorEvent,
)


@dataclass
class SecurityAlert:
    """Represents a security alert."""

    alert_id: int
    package_name: str
    vulnerable_version: str
    patched_version: Optional[str]
    severity: str  # "critical", "high", "medium", "low"
    summary: str
    description: str
    cve_id: Optional[str]
    created_at: datetime
    html_url: str
    state: str  # "open", "fixed", "dismissed"


class SecurityClient(Protocol):
    """Protocol for security alerts client."""

    async def get_dependabot_alerts(
        self,
        repo: str,
        state: str = "open",
        severity: Optional[str] = None,
        limit: int = 20,
    ) -> List[SecurityAlert]:
        """Get Dependabot security alerts."""
        ...

    async def get_code_scanning_alerts(
        self,
        repo: str,
        state: str = "open",
        limit: int = 20,
    ) -> List[SecurityAlert]:
        """Get code scanning alerts."""
        ...


class SecurityMonitor(BaseMonitor):
    """Monitor for security vulnerabilities."""

    SEVERITY_MAP = {
        "critical": EventSeverity.CRITICAL,
        "high": EventSeverity.HIGH,
        "medium": EventSeverity.MEDIUM,
        "low": EventSeverity.LOW,
    }

    def __init__(
        self,
        security_client: Optional[SecurityClient] = None,
        repositories: Optional[List[str]] = None,
        enabled: bool = True,
    ):
        """Initialize Security Monitor.

        Args:
            security_client: Security alerts client
            repositories: List of repositories to monitor
            enabled: Whether monitor is enabled
        """
        super().__init__(name="security_monitor", enabled=enabled)
        self._security_client = security_client
        self._repositories = repositories or []

    async def check(self) -> List[MonitorEvent]:
        """Check for security alerts.

        Returns:
            List of security events
        """
        if not self.enabled:
            return []

        if not self._security_client:
            return []

        self._last_check = datetime.utcnow()
        new_events: List[MonitorEvent] = []

        for repo in self._repositories:
            try:
                alerts = await self._security_client.get_dependabot_alerts(
                    repo=repo,
                    state="open",
                    limit=20,
                )

                for alert in alerts:
                    event_id = f"security-{repo}-{alert.alert_id}"

                    if self._is_processed(event_id):
                        continue

                    event = self._create_security_event(alert, repo, event_id)
                    self._record_event(event)
                    new_events.append(event)

            except Exception:
                pass

        return new_events

    def _create_security_event(
        self,
        alert: SecurityAlert,
        repo: str,
        event_id: str,
    ) -> MonitorEvent:
        """Create a security alert event.

        Args:
            alert: Security alert data
            repo: Repository name
            event_id: Unique event identifier

        Returns:
            MonitorEvent for the alert
        """
        severity = self.SEVERITY_MAP.get(
            alert.severity.lower(),
            EventSeverity.MEDIUM,
        )

        fix_info = ""
        if alert.patched_version:
            fix_info = f"\n修复版本: {alert.patched_version}"

        return MonitorEvent(
            event_id=event_id,
            event_type=EventType.SECURITY_VULN,
            severity=severity,
            title=f"安全漏洞: {alert.package_name}",
            description=f"{alert.summary}\n"
                       f"受影响版本: {alert.vulnerable_version}"
                       f"{fix_info}",
            source=self.name,
            timestamp=alert.created_at,
            metadata={
                "repository": repo,
                "alert_id": alert.alert_id,
                "package_name": alert.package_name,
                "vulnerable_version": alert.vulnerable_version,
                "patched_version": alert.patched_version,
                "severity": alert.severity,
                "cve_id": alert.cve_id,
                "html_url": alert.html_url,
            },
        )

    def check_sync(self, alerts: List[Dict[str, Any]]) -> List[MonitorEvent]:
        """Synchronous check for testing.

        Args:
            alerts: List of alert dictionaries

        Returns:
            List of security events
        """
        self._last_check = datetime.utcnow()
        new_events: List[MonitorEvent] = []

        for alert_data in alerts:
            alert = SecurityAlert(
                alert_id=alert_data["alert_id"],
                package_name=alert_data.get("package_name", "unknown"),
                vulnerable_version=alert_data.get("vulnerable_version", "unknown"),
                patched_version=alert_data.get("patched_version"),
                severity=alert_data.get("severity", "medium"),
                summary=alert_data.get("summary", ""),
                description=alert_data.get("description", ""),
                cve_id=alert_data.get("cve_id"),
                created_at=alert_data.get("created_at", datetime.utcnow()),
                html_url=alert_data.get("html_url", ""),
                state=alert_data.get("state", "open"),
            )

            repo = alert_data.get("repository", "unknown")
            event_id = f"security-{repo}-{alert.alert_id}"

            if self._is_processed(event_id):
                continue

            if alert.state != "open":
                self._mark_processed(event_id)
                continue

            event = self._create_security_event(alert, repo, event_id)
            self._record_event(event)
            new_events.append(event)

        return new_events
