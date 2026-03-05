package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/config"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/handler"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/middleware"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/repository"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/service"
	"github.com/go-chi/chi/v5"
)

//go:embed static/*
var staticFS embed.FS

func main() {
	configPath := flag.String("config", "config.yaml", "path to config file")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	repo, err := repository.New(cfg)
	if err != nil {
		log.Fatalf("failed to initialize repository: %v", err)
	}
	defer repo.Close()

	svc := service.New(repo, cfg)

	r := chi.NewRouter()
	r.Use(middleware.Recovery)
	r.Use(middleware.CORS(cfg.Server.CORSOrigin))
	r.Use(middleware.Audit)

	// BUG-J: limit request body size to prevent OOM from large uploads.
	// NOTE: must be registered BEFORE handler.Register() — chi panics if
	// r.Use() is called after any route has been defined on the same mux.
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, int64(cfg.Server.BodyLimitMB)*1024*1024)
			next.ServeHTTP(w, r)
		})
	})

	handler.Register(r, svc, cfg)

	// Serve frontend static files (embedded from build)
	staticSub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("failed to create sub filesystem: %v", err)
	}
	fileServer := http.FileServer(http.FS(staticSub))

	// SPA fallback: serve index.html for non-API, non-file routes
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		// If it's an API route, return 404
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(`{"error":{"code":"NOT_FOUND","message":"endpoint not found"}}`))
			return
		}

		// Try to serve the static file
		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}
		// Check if file exists in embedded FS
		if _, err := staticSub.(fs.ReadFileFS).ReadFile(strings.TrimPrefix(path, "/")); err == nil {
			fileServer.ServeHTTP(w, r)
			return
		}

		// SPA fallback: serve index.html for client-side routing
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})

	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	log.Printf("starting server on %s", addr)

	srv := &http.Server{
		Addr:    addr,
		Handler: r,
		// Phase 4: use config values instead of hardcoded timeouts.
		ReadTimeout:  time.Duration(cfg.Server.Timeouts.ReadSec) * time.Second,
		WriteTimeout: time.Duration(cfg.Server.Timeouts.WriteSec) * time.Second,
		IdleTimeout:  time.Duration(cfg.Server.Timeouts.IdleSec) * time.Second,
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("shutting down server...")
		srv.Close()
	}()

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}
