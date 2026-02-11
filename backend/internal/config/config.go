package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Targets   []Target   `yaml:"targets"`
	Databases []Database `yaml:"databases"`
	Server    Server     `yaml:"server"`
}

type Target struct {
	ID       string `yaml:"id"`
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	User     string `yaml:"user"`
	Password string `yaml:"password"`
}

type Database struct {
	TargetID        string   `yaml:"target_id"`
	Name            string   `yaml:"name"`
	AllowedBranches []string `yaml:"allowed_branches"`
}

type Server struct {
	Port       int    `yaml:"port"`
	CORSOrigin string `yaml:"cors_origin"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	if cfg.Server.CORSOrigin == "" {
		cfg.Server.CORSOrigin = "*"
	}

	return &cfg, nil
}

func (c *Config) FindTarget(id string) (*Target, error) {
	for i := range c.Targets {
		if c.Targets[i].ID == id {
			return &c.Targets[i], nil
		}
	}
	return nil, fmt.Errorf("target %q not found", id)
}

func (c *Config) FindDatabases(targetID string) []Database {
	var result []Database
	for _, db := range c.Databases {
		if db.TargetID == targetID {
			result = append(result, db)
		}
	}
	return result
}
