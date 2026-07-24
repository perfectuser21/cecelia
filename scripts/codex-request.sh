#!/usr/bin/env bash
# Retired: company Codex credentials are issued only by the Codex Slot broker.

printf '%s\n' \
  'codex-request is retired; use: codex-slot start [--project <project>] [--name <name>]' \
  >&2
exit 64
