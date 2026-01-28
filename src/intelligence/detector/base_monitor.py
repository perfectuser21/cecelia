"""Base Monitor - Abstract base class for all monitors."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional


class EventType(str, Enum):
    """Types of monitor events."""

    CI_FAILURE = "ci_failure"
    CI_SUCCESS = "ci_success"
    CODE_PUSH = "code_push"
    CODE_PR = "code_pr"
    SECURITY_VULN = "security_vulnerability"
    SECURITY_ALERT = "security_alert"
    DEPENDENCY_UPDATE = "dependency_update"


class EventSeverity(str, Enum):
    """Severity levels for events."""

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


@dataclass
class MonitorEvent:
    """Represents an event detected by a monitor."""

    event_type: EventType
    severity: EventSeverity
    title: str
    description: str
    source: str
    timestamp: datetime = field(default_factory=datetime.utcnow)
    metadata: Dict[str, Any] = field(default_factory=dict)
    event_id: Optional[str] = None

    def __post_init__(self):
        """Generate event_id if not provided."""
        if self.event_id is None:
            ts = self.timestamp.strftime("%Y%m%d%H%M%S")
            self.event_id = f"{self.event_type.value}-{ts}"

    def to_dict(self) -> Dict[str, Any]:
        """Convert event to dictionary."""
        return {
            "event_id": self.event_id,
            "event_type": self.event_type.value,
            "severity": self.severity.value,
            "title": self.title,
            "description": self.description,
            "source": self.source,
            "timestamp": self.timestamp.isoformat(),
            "metadata": self.metadata,
        }

    def to_task(self) -> Dict[str, Any]:
        """Convert event to a task for scheduling."""
        priority_map = {
            EventSeverity.CRITICAL: "P0",
            EventSeverity.HIGH: "P0",
            EventSeverity.MEDIUM: "P1",
            EventSeverity.LOW: "P2",
            EventSeverity.INFO: "P2",
        }

        return {
            "id": f"auto-{self.event_id}",
            "title": self.title,
            "description": self.description,
            "priority": priority_map[self.severity],
            "tags": ["auto-created", self.event_type.value],
            "metadata": {
                "source_event": self.event_id,
                "source_monitor": self.source,
                **self.metadata,
            },
        }


class BaseMonitor(ABC):
    """Abstract base class for all monitors."""

    def __init__(self, name: str, enabled: bool = True):
        """Initialize monitor.

        Args:
            name: Monitor name
            enabled: Whether monitor is enabled
        """
        self.name = name
        self.enabled = enabled
        self._events: List[MonitorEvent] = []
        self._last_check: Optional[datetime] = None
        self._processed_ids: set = set()

    @abstractmethod
    async def check(self) -> List[MonitorEvent]:
        """Check for new events.

        Returns:
            List of new events detected
        """
        pass

    def get_status(self) -> Dict[str, Any]:
        """Get monitor status.

        Returns:
            Status dictionary
        """
        return {
            "name": self.name,
            "enabled": self.enabled,
            "last_check": self._last_check.isoformat() if self._last_check else None,
            "events_detected": len(self._events),
            "processed_ids_count": len(self._processed_ids),
        }

    def get_recent_events(self, limit: int = 10) -> List[MonitorEvent]:
        """Get recent events.

        Args:
            limit: Maximum number of events to return

        Returns:
            List of recent events
        """
        return sorted(
            self._events,
            key=lambda e: e.timestamp,
            reverse=True,
        )[:limit]

    def _is_processed(self, event_id: str) -> bool:
        """Check if event was already processed.

        Args:
            event_id: Event identifier

        Returns:
            True if already processed
        """
        return event_id in self._processed_ids

    def _mark_processed(self, event_id: str) -> None:
        """Mark event as processed.

        Args:
            event_id: Event identifier
        """
        self._processed_ids.add(event_id)

    def _record_event(self, event: MonitorEvent) -> None:
        """Record a new event.

        Args:
            event: Event to record
        """
        self._events.append(event)
        self._mark_processed(event.event_id)

    def clear_events(self) -> None:
        """Clear all recorded events."""
        self._events.clear()
