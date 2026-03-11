package config

import (
	"os"
	"path/filepath"
	"testing"
)

func writeConfigFile(t *testing.T, contents string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

func TestLoadAppliesDefaultsForRecoveryRetrySearchAndPool(t *testing.T) {
	cfg, err := Load(writeConfigFile(t, `
targets:
  - id: local
    host: localhost
    port: 3306
    user: root
    password: ""
databases:
  - target_id: local
    name: test_db
server:
  port: 8080
`))
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if got := cfg.Server.Recovery.BranchReadySec; got != 10 {
		t.Fatalf("BranchReadySec default = %d, want 10", got)
	}
	if got := cfg.Server.Recovery.BranchReadyPollMS; got != 500 {
		t.Fatalf("BranchReadyPollMS default = %d, want 500", got)
	}
	if got := cfg.Server.Retries.TagRetryAttempts; got != 3 {
		t.Fatalf("TagRetryAttempts default = %d, want 3", got)
	}
	if got := cfg.Server.Retries.TagRetryDelayMS; got != 500 {
		t.Fatalf("TagRetryDelayMS default = %d, want 500", got)
	}
	if got := cfg.Server.Search.TimeoutSec; got != 5 {
		t.Fatalf("Search.TimeoutSec default = %d, want 5", got)
	}
	if got := cfg.Server.Pool.MaxOpen; got != 20 {
		t.Fatalf("Pool.MaxOpen default = %d, want 20", got)
	}
	if got := cfg.Server.Pool.MaxIdle; got != 10 {
		t.Fatalf("Pool.MaxIdle default = %d, want 10", got)
	}
	if got := cfg.Server.Pool.ConnLifetimeSec; got != 3600 {
		t.Fatalf("Pool.ConnLifetimeSec default = %d, want 3600", got)
	}
}

func TestLoadHonorsConfiguredRecoveryRetrySearchAndPoolValues(t *testing.T) {
	cfg, err := Load(writeConfigFile(t, `
targets:
  - id: local
    host: localhost
    port: 3306
    user: root
    password: ""
databases:
  - target_id: local
    name: test_db
server:
  port: 8080
  recovery:
    branch_ready_sec: 22
    branch_ready_poll_ms: 750
  retries:
    tag_retry_attempts: 5
    tag_retry_delay_ms: 900
  search:
    timeout_sec: 12
  pool:
    max_open: 31
    max_idle: 17
    conn_lifetime_sec: 181
`))
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if got := cfg.Server.Recovery.BranchReadySec; got != 22 {
		t.Fatalf("BranchReadySec = %d, want 22", got)
	}
	if got := cfg.Server.Recovery.BranchReadyPollMS; got != 750 {
		t.Fatalf("BranchReadyPollMS = %d, want 750", got)
	}
	if got := cfg.Server.Retries.TagRetryAttempts; got != 5 {
		t.Fatalf("TagRetryAttempts = %d, want 5", got)
	}
	if got := cfg.Server.Retries.TagRetryDelayMS; got != 900 {
		t.Fatalf("TagRetryDelayMS = %d, want 900", got)
	}
	if got := cfg.Server.Search.TimeoutSec; got != 12 {
		t.Fatalf("Search.TimeoutSec = %d, want 12", got)
	}
	if got := cfg.Server.Pool.MaxOpen; got != 31 {
		t.Fatalf("Pool.MaxOpen = %d, want 31", got)
	}
	if got := cfg.Server.Pool.MaxIdle; got != 17 {
		t.Fatalf("Pool.MaxIdle = %d, want 17", got)
	}
	if got := cfg.Server.Pool.ConnLifetimeSec; got != 181 {
		t.Fatalf("Pool.ConnLifetimeSec = %d, want 181", got)
	}
}

func TestFindDatabaseReturnsConfiguredDatabase(t *testing.T) {
	cfg, err := Load(writeConfigFile(t, `
targets:
  - id: local
    host: localhost
    port: 3306
    user: root
    password: ""
databases:
  - target_id: local
    name: test_db
    allowed_branches:
      - main
      - wi/*
server:
  port: 8080
`))
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	db, err := cfg.FindDatabase("local", "test_db")
	if err != nil {
		t.Fatalf("FindDatabase returned error: %v", err)
	}
	if db.Name != "test_db" {
		t.Fatalf("FindDatabase returned %q, want test_db", db.Name)
	}
	if len(db.AllowedBranches) != 2 {
		t.Fatalf("AllowedBranches len = %d, want 2", len(db.AllowedBranches))
	}
}
