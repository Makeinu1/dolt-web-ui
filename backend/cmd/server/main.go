package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/config"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/handler"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/middleware"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/repository"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/service"
	"github.com/go-chi/chi/v5"
)

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

	handler.Register(r, svc, cfg)

	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	log.Printf("starting server on %s", addr)

	srv := &http.Server{Addr: addr, Handler: r}

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
