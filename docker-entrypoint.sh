#!/bin/bash
set -Eeuo pipefail

echo "Starting QLD AI Tutor..."

BACKEND_PID=""
FRONTEND_PID=""

terminate_children() {
    local pid
    for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done

    # Give both runtimes time to run their shutdown hooks, then prevent an
    # unresponsive sibling from keeping the container alive indefinitely.
    for _ in $(seq 1 100); do
        local alive=0
        for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
            if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                alive=1
            fi
        done
        [ "$alive" -eq 0 ] && break
        sleep 0.1
    done

    for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill -KILL "$pid" 2>/dev/null || true
        fi
        if [ -n "$pid" ]; then
            wait "$pid" 2>/dev/null || true
        fi
    done
}

cleanup() {
    local status=$?
    trap - EXIT TERM INT
    terminate_children
    exit "$status"
}

trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# Ensure mutable data paths exist. A fresh credential store must contain valid
# JSON; existing files (including deliberately corrupt non-empty stores) are
# never overwritten here.
mkdir -p /app/data/logs /app/data/exams /app/data/backups
if [ ! -e /app/data/credentials.json ]; then
    old_umask=$(umask)
    umask 077
    credentials_tmp=$(mktemp /app/data/.credentials.json.XXXXXX)
    printf '{}\n' > "$credentials_tmp"
    mv "$credentials_tmp" /app/data/credentials.json
    umask "$old_umask"
fi

# The image starts as root for bind-mount compatibility. Keep existing host
# deployment behaviour while ensuring the application can write its data.
if [ "$(id -u)" = "0" ]; then
    chown -R tutoruser:tutorgroup /app/data 2>/dev/null || true
fi

cd /app
uvicorn backend.api:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

# Do not expose a frontend that can only return backend connection failures.
backend_ready=0
for _ in $(seq 1 120); do
    if curl --fail --silent --show-error --max-time 2 \
        http://127.0.0.1:8000/api/ready >/dev/null 2>&1; then
        backend_ready=1
        break
    fi
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        wait "$BACKEND_PID"
        exit $?
    fi
    sleep 1
done

if [ "$backend_ready" -ne 1 ]; then
    echo "Backend did not become ready within 120 seconds" >&2
    exit 1
fi

cd /app/frontend
HOSTNAME=0.0.0.0 PORT=3000 node server.js &
FRONTEND_PID=$!

echo "System ready - Backend :8000, Frontend :3000"

# Return the first child failure. The EXIT trap always stops and reaps the
# sibling so Docker never leaves a half-running application.
set +e
wait -n "$BACKEND_PID" "$FRONTEND_PID"
status=$?
set -e
exit "$status"
