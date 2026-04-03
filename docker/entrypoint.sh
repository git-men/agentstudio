#!/bin/bash
set -e

export HOME=/data
/opt/clawstudio/anydev-init.sh /data

exec "$@"
