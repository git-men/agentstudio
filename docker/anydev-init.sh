#!/bin/bash
set -e

DATA_HOME="${1:-/data}"

mkdir -p "$DATA_HOME/.agentstudio"/{data,config,agents,run,scripts,slack-session-locks,scheduled-tasks}
mkdir -p "$DATA_HOME/.claude-internal/projects"
mkdir -p "$DATA_HOME/.claude/projects"

# Ensure shell profiles exist at $DATA_HOME so that `. ~/.bashrc` works
# when HOME is already set to /data (e.g. via Dockerfile ENV or profile.d)
for rc in .bashrc .profile; do
  if [ ! -f "$DATA_HOME/$rc" ]; then
    echo "export HOME=$DATA_HOME" > "$DATA_HOME/$rc"
  fi
done

echo "[anydev-init] Data directories ready at $DATA_HOME"
