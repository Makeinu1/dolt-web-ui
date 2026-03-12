#!/usr/bin/env bash

set -euo pipefail

TESTENV_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${TESTENV_DIR}/../.." && pwd)"
GOCACHE_DIR="${REPO_ROOT}/backend/.gocache"
BACKEND_LOG_FILE="${PLAYWRIGHT_BACKEND_LOG:-}"

cleanup() {
  "${TESTENV_DIR}/stop"
}

trap cleanup EXIT INT TERM

"${TESTENV_DIR}/reset"
mkdir -p "${GOCACHE_DIR}"

(
  cd "${REPO_ROOT}/backend"
  if [[ -n "${BACKEND_LOG_FILE}" ]]; then
    mkdir -p "$(dirname "${BACKEND_LOG_FILE}")"
    : > "${BACKEND_LOG_FILE}"
    env GOCACHE="${GOCACHE_DIR}" go run ./cmd/server -config ../config.test.yaml 2>&1 | tee -a "${BACKEND_LOG_FILE}"
  else
    env GOCACHE="${GOCACHE_DIR}" go run ./cmd/server -config ../config.test.yaml
  fi
)
