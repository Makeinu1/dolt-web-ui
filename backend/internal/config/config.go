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
	Port        int      `yaml:"port"`
	CORSOrigin  string   `yaml:"cors_origin"`
	BodyLimitMB int      `yaml:"body_limit_mb"` // BUG-J: configurable request body size limit
	Timeouts    Timeouts `yaml:"timeouts"`
	Recovery    Recovery `yaml:"recovery"`
	Retries     Retries  `yaml:"retries"`
	Search      Search   `yaml:"search"`
	Pool        Pool     `yaml:"pool"`
}

type Timeouts struct {
	ReadSec  int `yaml:"read_sec"`  // HTTP read timeout (default 30s)
	WriteSec int `yaml:"write_sec"` // HTTP write timeout for heavy ops like DOLT_MERGE (default 300s)
	IdleSec  int `yaml:"idle_sec"`  // HTTP idle timeout (default 120s)
}

type Recovery struct {
	BranchReadySec    int `yaml:"branch_ready_sec"`
	BranchReadyPollMS int `yaml:"branch_ready_poll_ms"`
}

type Retries struct {
	TagRetryAttempts int `yaml:"tag_retry_attempts"`
	TagRetryDelayMS  int `yaml:"tag_retry_delay_ms"`
}

type Search struct {
	TimeoutSec int `yaml:"timeout_sec"`
}

type Pool struct {
	MaxOpen         int `yaml:"max_open"`          // max open DB connections (default 5)
	MaxIdle         int `yaml:"max_idle"`          // max idle DB connections (default 5)
	ConnLifetimeSec int `yaml:"conn_lifetime_sec"` // max connection lifetime (default 3600s)
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
	// Phase 4: apply defaults for timeouts
	if cfg.Server.Timeouts.ReadSec == 0 {
		cfg.Server.Timeouts.ReadSec = 30
	}
	if cfg.Server.Timeouts.WriteSec == 0 {
		cfg.Server.Timeouts.WriteSec = 300
	}
	if cfg.Server.Timeouts.IdleSec == 0 {
		cfg.Server.Timeouts.IdleSec = 120
	}
	// BUG-J: default body size limit
	if cfg.Server.BodyLimitMB == 0 {
		cfg.Server.BodyLimitMB = 10
	}
	if cfg.Server.Recovery.BranchReadySec == 0 {
		cfg.Server.Recovery.BranchReadySec = 10
	}
	if cfg.Server.Recovery.BranchReadyPollMS == 0 {
		cfg.Server.Recovery.BranchReadyPollMS = 500
	}
	if cfg.Server.Retries.TagRetryAttempts == 0 {
		cfg.Server.Retries.TagRetryAttempts = 3
	}
	if cfg.Server.Retries.TagRetryDelayMS == 0 {
		cfg.Server.Retries.TagRetryDelayMS = 500
	}
	if cfg.Server.Search.TimeoutSec == 0 {
		cfg.Server.Search.TimeoutSec = 5
	}
	if cfg.Server.Pool.MaxOpen == 0 {
		cfg.Server.Pool.MaxOpen = 20
	}
	if cfg.Server.Pool.MaxIdle == 0 {
		cfg.Server.Pool.MaxIdle = 10
	}
	if cfg.Server.Pool.ConnLifetimeSec == 0 {
		cfg.Server.Pool.ConnLifetimeSec = 3600
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

func (c *Config) FindDatabase(targetID, name string) (*Database, error) {
	for i := range c.Databases {
		db := &c.Databases[i]
		if db.TargetID == targetID && db.Name == name {
			return db, nil
		}
	}
	return nil, fmt.Errorf("database %q not found for target %q", name, targetID)
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
