.PHONY: build build-linux test lint dev clean

# Build frontend and backend
build: build-frontend build-backend

build-frontend:
	cd frontend && npm run build

# Copy frontend build output into backend embed directory
copy-static: build-frontend
	rm -rf backend/cmd/server/static
	cp -r frontend/dist backend/cmd/server/static

build-backend: copy-static
	cd backend && go build -o ../dist/dolt-web-ui ./cmd/server

# Cross-compile for Linux (amd64)
build-linux: copy-static
	cd backend && GOOS=linux GOARCH=amd64 go build -o ../dist/dolt-web-ui-linux-amd64 ./cmd/server

# Run tests
test: test-backend test-frontend

test-backend:
	cd backend && go test -race ./...

test-frontend:
	cd frontend && npx vitest run

# Lint
lint: lint-backend lint-frontend

lint-backend:
	cd backend && go vet ./...

lint-frontend:
	cd frontend && npx tsc --noEmit

# Development servers
dev:
	@echo "Start backend: cd backend && go run ./cmd/server -config ../config.yaml"
	@echo "Start frontend: cd frontend && npm run dev"

clean:
	rm -rf dist/ frontend/dist/
