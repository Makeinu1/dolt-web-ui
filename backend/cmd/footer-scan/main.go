// footer-scan scans all commits on the main branch of a Dolt database and
// validates approval footers. It reports any commits whose footer is present
// but invalid (data corruption that would cause history read failures).
//
// Usage:
//
//	go run ./cmd/footer-scan --config config.yaml --target default --db Test
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"log"
	"os"

	_ "github.com/go-sql-driver/mysql"
	"gopkg.in/yaml.v3"
)

type config struct {
	Targets []struct {
		ID       string `yaml:"id"`
		Host     string `yaml:"host"`
		Port     int    `yaml:"port"`
		User     string `yaml:"user"`
		Password string `yaml:"password"`
	} `yaml:"targets"`
}

func main() {
	configPath := flag.String("config", "config.yaml", "path to config.yaml")
	targetID := flag.String("target", "default", "target ID from config")
	dbName := flag.String("db", "Test", "Dolt database name to scan")
	flag.Parse()

	data, err := os.ReadFile(*configPath)
	if err != nil {
		log.Fatalf("failed to read config %s: %v", *configPath, err)
	}

	var cfg config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		log.Fatalf("failed to parse config: %v", err)
	}

	var host string
	var port int
	var user, password string
	found := false
	for _, t := range cfg.Targets {
		if t.ID == *targetID {
			host = t.Host
			if host == "" {
				host = "127.0.0.1"
			}
			port = t.Port
			if port == 0 {
				port = 3306
			}
			user = t.User
			if user == "" {
				user = "root"
			}
			password = t.Password
			found = true
			break
		}
	}
	if !found {
		log.Fatalf("target %q not found in config", *targetID)
	}

	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s", user, password, host, port, *dbName)
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Fatalf("failed to open DB: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("failed to connect to %s:%d/%s: %v", host, port, *dbName, err)
	}

	rows, err := db.Query("SELECT commit_hash, message FROM dolt_log('main')")
	if err != nil {
		log.Fatalf("failed to query dolt_log: %v", err)
	}
	defer rows.Close()

	var invalid int
	commits := make([]footerScanCommit, 0)
	for rows.Next() {
		var hash, message string
		if err := rows.Scan(&hash, &message); err != nil {
			log.Printf("WARN: scan error: %v", err)
			continue
		}
		commits = append(commits, footerScanCommit{Hash: hash, Message: message})
	}

	if err := rows.Err(); err != nil {
		log.Fatalf("row iteration error: %v", err)
	}

	results, invalid := scanApprovalFooters(commits)
	for _, result := range results {
		switch result.Status {
		case footerScanStatusInvalid:
			fmt.Printf("INVALID  %s  %s\n", result.Hash, result.Problem)
		case footerScanStatusValid:
			fmt.Printf("OK       %s  req/%s\n", result.Hash, result.WorkItem)
		}
	}

	total := len(results)
	fmt.Printf("\nScanned %d commits, %d invalid footers found.\n", total, invalid)
	if invalid > 0 {
		os.Exit(1)
	}
}
