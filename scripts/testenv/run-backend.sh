#!/usr/bin/env bash

set -euo pipefail

TESTENV_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${TESTENV_DIR}/../.." && pwd)"
GOCACHE_DIR="${REPO_ROOT}/backend/.gocache"

cleanup() {
  "${TESTENV_DIR}/stop"
}

trap cleanup EXIT INT TERM

"${TESTENV_DIR}/reset"
mkdir -p "${GOCACHE_DIR}"

(
  cd "${REPO_ROOT}/backend"
  env GOCACHE="${GOCACHE_DIR}" go run ./cmd/server -config ../config.test.yaml
)
