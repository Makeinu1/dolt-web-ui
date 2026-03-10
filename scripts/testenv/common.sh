#!/usr/bin/env bash

set -euo pipefail

TESTENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${TESTENV_DIR}/../.." && pwd)"
STATE_DIR="${REPO_ROOT}/.tmp/testenv"
DATA_DIR="${STATE_DIR}/data"
CFG_DIR="${STATE_DIR}/.doltcfg"
SQL_HOST="${DOLT_WEB_UI_TEST_SQL_HOST:-127.0.0.1}"
SQL_PORT="${DOLT_WEB_UI_TEST_SQL_PORT:-13306}"
PID_FILE="${STATE_DIR}/dolt-sql-server.pid"
LOG_FILE="${STATE_DIR}/dolt-sql-server.log"

ensure_dirs() {
  mkdir -p "${STATE_DIR}" "${DATA_DIR}" "${CFG_DIR}"
}

require_dolt() {
  if ! command -v dolt >/dev/null 2>&1; then
    echo "dolt command is required but was not found on PATH" >&2
    exit 1
  fi
}

is_running() {
  if [[ ! -f "${PID_FILE}" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "${PID_FILE}")"
  kill -0 "${pid}" >/dev/null 2>&1
}

wait_for_sql() {
  local attempts=60
  for _ in $(seq 1 "${attempts}"); do
    if dolt --no-tls --host "${SQL_HOST}" --port "${SQL_PORT}" sql -q "show databases" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "Timed out waiting for dolt sql-server on ${SQL_HOST}:${SQL_PORT}" >&2
  return 1
}

repo_sql() {
  local repo_name="$1"
  shift
  (
    cd "${DATA_DIR}/${repo_name}"
    dolt sql "$@"
  )
}
