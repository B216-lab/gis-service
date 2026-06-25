#!/bin/sh
set -eu

child_pid=""
last_hash=""

stop_child() {
  if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
    kill "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
}

trap 'stop_child; exit 0' INT TERM

hash_sources() {
  find . -type f \
    \( -name '*.go' -o -name 'go.mod' -o -name 'go.sum' \) \
    -not -path './tmp/*' \
    -exec sha256sum {} + | sort | sha256sum
}

while true; do
  current_hash="$(hash_sources)"

  if [ "$current_hash" != "$last_hash" ]; then
    stop_child
    echo "backend changed; restarting"
    go run ./cmd/api &
    child_pid="$!"
    last_hash="$current_hash"
  fi

  if [ -n "$child_pid" ] && ! kill -0 "$child_pid" 2>/dev/null; then
    wait "$child_pid" 2>/dev/null || true
    child_pid=""
    last_hash=""
  fi

  sleep 1
done
