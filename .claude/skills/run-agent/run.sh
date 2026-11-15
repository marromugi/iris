#!/bin/sh
# Starts, checks and stops the agent Worker (apps/agent) on its own port, state and log directory.
# Usage: run.sh start|check|stop [port]     (port defaults to 8787)
# Nothing here sends a message to the agent, so no model is called.
set -eu

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ACTION="${1:?usage: run.sh start|check|stop [port]}"
PORT="${2:-8787}"
RUN_DIR="/private/tmp/iris-run/$PORT"
STATE_DIR="$RUN_DIR/state"
PID_FILE="$RUN_DIR/pid"
LOG="$RUN_DIR/wrangler.log"
CHECK_LOG="$RUN_DIR/check.log"
ORIGIN="https://localhost:$PORT"
CERT_DIR="$HOME/.iris-dev"

# Kills a process and everything it started (pnpm, wrangler, workerd). Only the tree under the pid in the pid file.
kill_tree() {
  for child in $(pgrep -P "$1" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill "$1" 2>/dev/null || true
}

case "$ACTION" in
start)
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Already running on $PORT (pid $(cat "$PID_FILE")). Stop it first." >&2
    exit 1
  fi
  # Another copy may be answering on this port (not ours to stop): pick another port instead.
  # A connection probe, not lsof: a server bound only to ::1 or 127.0.0.1 shows up here too.
  probe="$(curl -ks --max-time 3 -o /dev/null -w '%{http_code}' "https://localhost:$PORT/" 2>/dev/null || true)"
  if [ -n "$probe" ] && [ "$probe" != "000" ]; then
    echo "Port $PORT already answers (HTTP $probe), and this run did not start it. Use another port." >&2
    exit 1
  fi
  if [ ! -f "$CERT_DIR/cert.pem" ] || [ ! -f "$CERT_DIR/key.pem" ]; then
    echo "Missing $CERT_DIR/cert.pem or key.pem. README.md (Worker) explains how to make them." >&2
    exit 1
  fi
  # A clean state every run: the database is migrated from empty.
  rm -rf "$STATE_DIR"
  mkdir -p "$RUN_DIR"
  : >"$LOG"
  cd "$ROOT/apps/agent"
  pnpm exec wrangler d1 migrations apply iris --local --persist-to "$STATE_DIR" >>"$LOG" 2>&1
  nohup pnpm exec wrangler dev --local --persist-to "$STATE_DIR" \
    --local-protocol https --https-cert-path "$CERT_DIR/cert.pem" --https-key-path "$CERT_DIR/key.pem" \
    --port "$PORT" --inspector-port "$((PORT + 10000))" \
    --var "ORIGIN:$ORIGIN" >>"$LOG" 2>&1 &
  echo $! >"$PID_FILE"
  echo "Started on $ORIGIN (pid $(cat "$PID_FILE")), log $LOG"
  # Ready means the Worker answers its discovery document, not just that a process is listening.
  i=0
  until [ "$(curl -ks -o /dev/null -w '%{http_code}' "$ORIGIN/.well-known/oauth-protected-resource/api")" = "200" ]; do
    if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "The server exited before it was ready. See $LOG." >&2
      exit 1
    fi
    i=$((i + 1))
    if [ "$i" -gt 120 ]; then
      echo "Not ready after 120 s. See $LOG." >&2
      exit 1
    fi
    sleep 1
  done
  echo "Ready: discovery document answers 200."
  ;;

check)
  # Only routes that need no sign-in. Each line: method, path, the status it must return.
  : >"$CHECK_LOG"
  failed=0
  while read -r method path want; do
    got="$(curl -ks -o /dev/null -w '%{http_code}' -X "$method" "$ORIGIN$path")"
    if [ "$got" = "$want" ]; then
      echo "ok   $method $path -> $got" | tee -a "$CHECK_LOG"
    else
      echo "FAIL $method $path -> $got (want $want)" | tee -a "$CHECK_LOG"
      failed=1
    fi
  done <<EOF
GET /.well-known/oauth-protected-resource/api 200
GET /api/me 401
GET /api/agents 401
EOF
  exit "$failed"
  ;;

stop)
  if [ ! -f "$PID_FILE" ]; then
    echo "Nothing started on $PORT (no pid file)." >&2
    exit 0
  fi
  pid="$(cat "$PID_FILE")"
  kill_tree "$pid"
  rm -f "$PID_FILE"
  echo "Stopped the tree under pid $pid on $PORT. Logs stay in $RUN_DIR."
  ;;

*)
  echo "usage: run.sh start|check|stop [port]" >&2
  exit 2
  ;;
esac
