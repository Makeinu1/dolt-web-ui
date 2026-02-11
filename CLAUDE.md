# Dolt Web UI

## Project Overview

Web UI for Dolt (Git-like version control SQL database). PSX data change management workbench.

## Architecture

- **Backend**: Go + chi router (stateless API server)
- **Frontend**: React 18 + TypeScript + Vite (SPA, embedded in Go binary)
- **Database**: Dolt SQL Server (external, configured via config.yaml)
- **Deployment**: Single binary with embedded frontend (cross-compiled for Linux)

## Directory Structure

- `backend/` - Go API server
- `frontend/` - React SPA
- `参考/` - v6f specification documents (read-only reference)

## Specification Reference

All API implementations must conform to the OpenAPI spec (SSOT):
`参考/dolt_web_ui_artifacts_20260211_v6f/dolt_web_ui_openapi_v6f.yaml`

SQL implementations follow:
`参考/dolt_web_ui_artifacts_20260211_v6f/dolt_web_ui_api_sql_mapping_v6f.md`

## Build Commands

```bash
make build          # Build for current OS
make build-linux    # Cross-compile for Linux (amd64)
make test           # Run all tests
make lint           # Run linters
make dev            # Start dev servers (backend + frontend)
```

## Backend Conventions

- Go module: `github.com/Makeinu1/dolt-web-ui/backend`
- Router: `github.com/go-chi/chi/v5`
- Config: YAML via `gopkg.in/yaml.v3`
- DB driver: `github.com/go-sql-driver/mysql` (Dolt uses MySQL protocol)
- 1 request = 1 connection = 1 branch session
- All write endpoints validate `expected_head` (optimistic locking)
- Main branch is read-only (MainGuard middleware)

## Frontend Conventions

- Package manager: npm
- State management: Zustand
- Data grid: AG Grid Community
- API client: auto-generated from OpenAPI spec
- Draft data stored in sessionStorage only (volatile)

## Testing

- Backend: `go test -race ./...` with table-driven tests
- Frontend: Vitest + React Testing Library
