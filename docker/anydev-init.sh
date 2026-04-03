#!/bin/bash
set -e

DATA_HOME="${1:-/data}"

mkdir -p "$DATA_HOME/.agentstudio"/{data,config,agents,run,scripts,slack-session-locks,scheduled-tasks}
mkdir -p "$DATA_HOME/.claude-internal/projects"
mkdir -p "$DATA_HOME/.claude/projects"

echo "[anydev-init] Data directories ready at $DATA_HOME"
