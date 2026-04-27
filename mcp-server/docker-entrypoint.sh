#!/bin/sh
set -e

# Ensure data directory exists and sqlite file is present so the container
# always has a database file to operate on. This supports the requirement
# that data/argos.sqlite is created on first run.
mkdir -p /app/data
if [ ! -f /app/data/argos.sqlite ]; then
  touch /app/data/argos.sqlite
fi

# Execute the container CMD
exec "$@"
