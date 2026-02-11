package service

import (
	"github.com/Makeinu1/dolt-web-ui/backend/internal/config"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/repository"
)

// Service provides the business logic for the Dolt Web UI API.
type Service struct {
	repo *repository.Repository
	cfg  *config.Config
}

func New(repo *repository.Repository, cfg *config.Config) *Service {
	return &Service{repo: repo, cfg: cfg}
}
