//go:build integration

package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func TestDiffSummaries_ReturnChangedTablesAndSchemaFlags(t *testing.T) {
	svc := newIntegrationService(t)
	branchName := uniqueWorkBranch(t, "diff-summary")

	if err := svc.CreateBranch(integrationContext(t), model.CreateBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: branchName,
	}); err != nil {
		t.Fatalf("create branch: %v", err)
	}

	commitRoleChange(t, svc, branchName, "diff-reviewer", "integration diff data change")

	schemaTable := fmt.Sprintf("diff_schema_%d", time.Now().UnixNano())
	conn, err := svc.repo.Conn(integrationContext(t), "local", "test_db", branchName)
	if err != nil {
		t.Fatalf("connect for schema change: %v", err)
	}
	defer conn.Close()

	if _, err := conn.ExecContext(integrationContext(t), fmt.Sprintf("CREATE TABLE `%s` (id INT PRIMARY KEY)", schemaTable)); err != nil {
		t.Fatalf("create schema-only table: %v", err)
	}
	if _, err := conn.ExecContext(integrationContext(t), "CALL DOLT_COMMIT('-Am', 'integration schema change')"); err != nil {
		t.Fatalf("commit schema-only table: %v", err)
	}

	lightEntries, err := svc.DiffSummaryLight(integrationContext(t), "local", "test_db", branchName, "main", branchName, "three_dot")
	if err != nil {
		t.Fatalf("light diff summary: %v", err)
	}

	foundUsers := false
	foundSchemaTable := false
	for _, entry := range lightEntries {
		switch entry.Table {
		case "users":
			foundUsers = true
			if !entry.HasDataChange {
				t.Fatalf("expected users to report data changes")
			}
		case schemaTable:
			foundSchemaTable = true
			if !entry.HasSchemaChange {
				t.Fatalf("expected %s to report schema changes", schemaTable)
			}
		}
	}
	if !foundUsers {
		t.Fatalf("users table missing from lightweight diff summary")
	}
	if !foundSchemaTable {
		t.Fatalf("schema-only table missing from lightweight diff summary")
	}

	heavyEntries, err := svc.DiffSummary(integrationContext(t), "local", "test_db", branchName, "main", branchName, "three_dot")
	if err != nil {
		t.Fatalf("heavy diff summary: %v", err)
	}

	foundHeavyUsers := false
	for _, entry := range heavyEntries {
		if entry.Table != "users" {
			continue
		}
		foundHeavyUsers = true
		if entry.Added+entry.Modified+entry.Removed == 0 {
			t.Fatalf("expected heavy diff summary counts for users")
		}
	}
	if !foundHeavyUsers {
		t.Fatalf("users table missing from heavy diff summary")
	}
}

func TestDiffSummaryLight_AllowsCommitHashRefAndRejectsDisallowedBranchRef(t *testing.T) {
	svc := newIntegrationService(t)
	branchName := uniqueWorkBranch(t, "diff-ref-policy")

	if err := svc.CreateBranch(integrationContext(t), model.CreateBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: branchName,
	}); err != nil {
		t.Fatalf("create branch: %v", err)
	}

	headHash := commitRoleChange(t, svc, branchName, "diff-policy", "integration diff ref policy")

	entries, err := svc.DiffSummaryLight(integrationContext(t), "local", "test_db", headHash, "main", headHash, "two_dot")
	if err != nil {
		t.Fatalf("diff summary with commit hash session ref: %v", err)
	}
	if len(entries) == 0 {
		t.Fatalf("expected diff summary entries when using commit hash ref")
	}

	hiddenBranch := fmt.Sprintf("scratch-%d", time.Now().UnixNano())
	conn, err := svc.repo.ConnProtectedMaintenance(integrationContext(t), "local", "test_db", "main")
	if err != nil {
		t.Fatalf("connect for hidden branch create: %v", err)
	}
	defer conn.Close()

	if _, err := conn.ExecContext(integrationContext(t), "CALL DOLT_BRANCH(?)", hiddenBranch); err != nil {
		t.Fatalf("create hidden branch: %v", err)
	}

	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		cleanupConn, err := svc.repo.ConnProtectedMaintenance(ctx, "local", "test_db", "main")
		if err != nil {
			t.Fatalf("connect for hidden branch cleanup: %v", err)
		}
		defer cleanupConn.Close()

		if _, err := cleanupConn.ExecContext(ctx, "CALL DOLT_BRANCH('-D', ?)", hiddenBranch); err != nil {
			t.Fatalf("cleanup hidden branch: %v", err)
		}
	})

	_, err = svc.DiffSummaryLight(integrationContext(t), "local", "test_db", branchName, "main", hiddenBranch, "three_dot")
	expectAPIErrorCode(t, err, model.CodeForbidden)
}
