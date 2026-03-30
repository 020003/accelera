#!/bin/sh
# Fix data directory ownership when volumes were created by an older root-based image.
chown -R accelera:accelera /app/data 2>/dev/null || true

# Drop to non-root user and exec the CMD
exec runuser -u accelera -- "$@"
