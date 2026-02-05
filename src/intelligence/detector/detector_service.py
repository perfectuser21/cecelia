"""Detector Service - Orchestrates all monitors."""

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional

from src.intelligence.detector.base_monitor import BaseMonitor, MonitorEvent
from src.intelligence.detector.ci_monitor import CIMonitor
from src.intelligence.detector.code_monitor import CodeMonitor
from src.intelligence.detector.security_monitor import SecurityMonitor


@dataclass
class DetectorStatus:
    """Overall detector service status."""

    running: bool
    monitors: Dict[str, Dict[str, Any]]
    total_events: int
    last_check: Optional[datetime]
    check_interval_seconds: int


class DetectorService:
    """Service that orchestrates all monitors."""

    def __init__(
        self,
        ci_monitor: Optional[CIMonitor] = None,
        code_monitor: Optional[CodeMonitor] = None,
        security_monitor: Optional[SecurityMonitor] = None,
        check_interval: int = 300,  # 5 minutes default
    ):
        """Initialize Detector Service.

        Args:
            ci_monitor: CI monitor instance
            code_monitor: Code monitor instance
            security_monitor: Security monitor instance
            check_interval: Interval between checks in seconds
        """
        self._monitors: Dict[str, BaseMonitor] = {}
        self._check_interval = check_interval
        self._running = False
        self._last_check: Optional[datetime] = None
        self._all_events: List[MonitorEvent] = []

        # Register monitors
        if ci_monitor:
            self._monitors["ci"] = ci_monitor
        if code_monitor:
            self._monitors["code"] = code_monitor
        if security_monitor:
            self._monitors["security"] = security_monitor

    def add_monitor(self, name: str, monitor: BaseMonitor) -> None:
        """Add a monitor.

        Args:
            name: Monitor name
            monitor: Monitor instance
        """
        self._monitors[name] = monitor

    def remove_monitor(self, name: str) -> None:
        """Remove a monitor.

        Args:
            name: Monitor name
        """
        self._monitors.pop(name, None)

    async def check_all(self) -> List[MonitorEvent]:
        """Run all monitors and collect events.

        Returns:
            List of new events from all monitors
        """
        self._last_check = datetime.utcnow()
        all_new_events: List[MonitorEvent] = []

        for name, monitor in self._monitors.items():
            if not monitor.enabled:
                continue

            try:
                events = await monitor.check()
                all_new_events.extend(events)
            except Exception:
                # Log error but continue with other monitors
                pass

        # Store all events
        self._all_events.extend(all_new_events)

        return all_new_events

    def check_all_sync(self) -> List[MonitorEvent]:
        """Synchronous version of check_all for testing.

        Returns:
            List of new events
        """
        self._last_check = datetime.utcnow()
        return []

    async def start(self) -> None:
        """Start the detector service loop."""
        self._running = True

        while self._running:
            await self.check_all()
            await asyncio.sleep(self._check_interval)

    def stop(self) -> None:
        """Stop the detector service."""
        self._running = False

    def get_status(self) -> DetectorStatus:
        """Get service status.

        Returns:
            DetectorStatus with current state
        """
        monitors_status = {}
        for name, monitor in self._monitors.items():
            monitors_status[name] = monitor.get_status()

        return DetectorStatus(
            running=self._running,
            monitors=monitors_status,
            total_events=len(self._all_events),
            last_check=self._last_check,
            check_interval_seconds=self._check_interval,
        )

    def get_recent_events(self, limit: int = 50) -> List[MonitorEvent]:
        """Get recent events from all monitors.

        Args:
            limit: Maximum number of events

        Returns:
            List of recent events
        """
        return sorted(
            self._all_events,
            key=lambda e: e.timestamp,
            reverse=True,
        )[:limit]

    def get_events_by_type(self, event_type: str) -> List[MonitorEvent]:
        """Get events of a specific type.

        Args:
            event_type: Event type to filter by

        Returns:
            List of events matching the type
        """
        return [
            e for e in self._all_events
            if e.event_type.value == event_type
        ]

    def get_events_by_severity(self, severity: str) -> List[MonitorEvent]:
        """Get events of a specific severity.

        Args:
            severity: Severity level to filter by

        Returns:
            List of events matching the severity
        """
        return [
            e for e in self._all_events
            if e.severity.value == severity
        ]

    def get_critical_events(self) -> List[MonitorEvent]:
        """Get all critical and high severity events.

        Returns:
            List of critical/high events
        """
        return [
            e for e in self._all_events
            if e.severity.value in ("critical", "high")
        ]

    def clear_events(self) -> None:
        """Clear all recorded events."""
        self._all_events.clear()
        for monitor in self._monitors.values():
            monitor.clear_events()

    def to_dict(self) -> Dict[str, Any]:
        """Convert service status to dictionary.

        Returns:
            Dictionary representation
        """
        status = self.get_status()
        return {
            "running": status.running,
            "monitors": status.monitors,
            "total_events": status.total_events,
            "last_check": status.last_check.isoformat() if status.last_check else None,
            "check_interval_seconds": status.check_interval_seconds,
        }
