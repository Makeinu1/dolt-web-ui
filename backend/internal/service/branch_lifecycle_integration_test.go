//go:build integration

package service

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/config"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/repository"
)

func newIntegrationService(t *testing.T) *Service {
	t.Helper()

	cfgPath := filepath.Join(testRepoRoot(), "config.test.yaml")
	cfg, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	repo, err := repository.New(cfg)
	if err != nil {
		t.Fatalf("new repository: %v", err)
	}
	t.Cleanup(repo.Close)

	return New(repo, cfg)
}

func integrationContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func uniqueWorkBranch(t *testing.T, prefix string) string {
	t.Helper()
	return fmt.Sprintf("wi/%s-%d", prefix, time.Now().UnixNano())
}

func mustHeadInDB(t *testing.T, svc *Service, dbName, branchName string) string {
	t.Helper()
	head, err := svc.GetHead(integrationContext(t), "local", dbName, branchName)
	if err != nil {
		t.Fatalf("get head for %s/%s: %v", dbName, branchName, err)
	}
	return head.Hash
}

func mustHead(t *testing.T, svc *Service, branchName string) string {
	t.Helper()
	return mustHeadInDB(t, svc, "test_db", branchName)
}

func commitRoleChange(t *testing.T, svc *Service, branchName, role, message string) string {
	t.Helper()
	resp, err := svc.Commit(integrationContext(t), model.CommitRequest{
		TargetID:      "local",
		DBName:        "test_db",
		BranchName:    branchName,
		ExpectedHead:  mustHead(t, svc, branchName),
		CommitMessage: message,
		Ops: []model.CommitOp{
			{
				Type:  "update",
				Table: "users",
				PK:    map[string]interface{}{"id": 1},
				Values: map[string]interface{}{
					"role": role,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("commit role change on %s: %v", branchName, err)
	}
	return resp.Hash
}

func expectAPIErrorCode(t *testing.T, err error, code string) {
	t.Helper()
	var apiErr *model.APIError
	if err == nil {
		t.Fatalf("expected API error %s, got nil", code)
	}
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected API error %s, got %T: %v", code, err, err)
	}
	if apiErr.Code != code {
		t.Fatalf("expected API error %s, got %s (%v)", code, apiErr.Code, err)
	}
}

func createHiddenBranch(t *testing.T, svc *Service, dbName string) string {
	t.Helper()

	hiddenBranch := fmt.Sprintf("scratch-%d", time.Now().UnixNano())
	conn, err := svc.repo.ConnProtectedMaintenance(integrationContext(t), "local", dbName, "main")
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

		cleanupConn, err := svc.repo.ConnProtectedMaintenance(ctx, "local", dbName, "main")
		if err != nil {
			t.Fatalf("connect for hidden branch cleanup: %v", err)
		}
		defer cleanupConn.Close()

		if _, err := cleanupConn.ExecContext(ctx, "CALL DOLT_BRANCH('-D', ?)", hiddenBranch); err != nil {
			t.Fatalf("cleanup hidden branch: %v", err)
		}
	})

	return hiddenBranch
}

func createMainTag(t *testing.T, svc *Service, dbName, tagName string) {
	t.Helper()

	conn, err := svc.repo.ConnProtectedMaintenance(integrationContext(t), "local", dbName, "main")
	if err != nil {
		t.Fatalf("connect for tag create: %v", err)
	}
	defer conn.Close()

	if _, err := conn.ExecContext(integrationContext(t), "CALL DOLT_TAG(?)", tagName); err != nil {
		t.Fatalf("create tag %s: %v", tagName, err)
	}

	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		cleanupConn, err := svc.repo.ConnProtectedMaintenance(ctx, "local", dbName, "main")
		if err != nil {
			t.Fatalf("connect for tag cleanup: %v", err)
		}
		defer cleanupConn.Close()

		if _, err := cleanupConn.ExecContext(ctx, "CALL DOLT_TAG('-d', ?)", tagName); err != nil {
			t.Fatalf("cleanup tag %s: %v", tagName, err)
		}
	})
}

func replaceTagMessageInDB(t *testing.T, svc *Service, dbName, tagName, tagHash, message string) {
	t.Helper()

	conn, err := svc.repo.ConnProtectedMaintenance(integrationContext(t), "local", dbName, "main")
	if err != nil {
		t.Fatalf("connect for tag rewrite: %v", err)
	}
	defer conn.Close()

	if _, err := conn.ExecContext(integrationContext(t), "CALL DOLT_TAG('-d', ?)", tagName); err != nil {
		t.Fatalf("delete tag %s for rewrite: %v", tagName, err)
	}
	if _, err := conn.ExecContext(integrationContext(t), "CALL DOLT_TAG('-m', ?, ?, ?)", message, tagName, tagHash); err != nil {
		t.Fatalf("rewrite tag %s: %v", tagName, err)
	}
}

func deleteTagInDB(t *testing.T, svc *Service, dbName, tagName string) {
	t.Helper()

	conn, err := svc.repo.ConnProtectedMaintenance(integrationContext(t), "local", dbName, "main")
	if err != nil {
		t.Fatalf("connect for tag delete: %v", err)
	}
	defer conn.Close()

	if _, err := conn.ExecContext(integrationContext(t), "CALL DOLT_TAG('-d', ?)", tagName); err != nil {
		t.Fatalf("delete tag %s: %v", tagName, err)
	}
}

func commitMessageInDB(t *testing.T, svc *Service, dbName, commitHash string) string {
	t.Helper()

	conn, err := svc.repo.ConnRevision(integrationContext(t), "local", dbName, "main")
	if err != nil {
		t.Fatalf("connect for commit message: %v", err)
	}
	defer conn.Close()

	var message string
	if err := conn.QueryRowContext(integrationContext(t), "SELECT message FROM dolt_log WHERE commit_hash = ? LIMIT 1", commitHash).Scan(&message); err != nil {
		t.Fatalf("query commit message for %s: %v", commitHash, err)
	}
	return message
}

func archiveTagsForWorkItemInDB(t *testing.T, svc *Service, dbName, workItem string) []string {
	t.Helper()
	conn, err := svc.repo.ConnRevision(integrationContext(t), "local", dbName, "main")
	if err != nil {
		t.Fatalf("connect for archive tags: %v", err)
	}
	defer conn.Close()

	rows, err := conn.QueryContext(integrationContext(t), "SELECT tag_name FROM dolt_tags WHERE tag_name LIKE ? ORDER BY tag_name", archiveTagPrefixForWorkItem(workItem)+"%")
	if err != nil {
		t.Fatalf("query archive tags: %v", err)
	}
	defer rows.Close()

	var tags []string
	for rows.Next() {
		var tagName string
		if err := rows.Scan(&tagName); err != nil {
			t.Fatalf("scan archive tag: %v", err)
		}
		tags = append(tags, tagName)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("archive tag rows: %v", err)
	}
	return tags
}

func archiveTagsForWorkItem(t *testing.T, svc *Service, workItem string) []string {
	t.Helper()
	return archiveTagsForWorkItemInDB(t, svc, "test_db", workItem)
}

func branchPresentInDB(t *testing.T, svc *Service, dbName, branchName string) bool {
	t.Helper()
	branches, err := svc.ListBranches(integrationContext(t), "local", dbName)
	if err != nil {
		t.Fatalf("list branches: %v", err)
	}
	for _, branch := range branches {
		if branch.Name == branchName {
			return true
		}
	}
	return false
}

func rawBranchExistsInDB(t *testing.T, svc *Service, dbName, branchName string) bool {
	t.Helper()

	conn, err := svc.repo.ConnRevision(integrationContext(t), "local", dbName, "main")
	if err != nil {
		t.Fatalf("connect for raw branch existence: %v", err)
	}
	defer conn.Close()

	exists, err := branchExists(integrationContext(t), conn, branchName)
	if err != nil {
		t.Fatalf("query raw branch existence for %s: %v", branchName, err)
	}
	return exists
}

func columnTypeInDB(t *testing.T, svc *Service, dbName, branchName, tableName, columnName string) string {
	t.Helper()

	conn, err := svc.repo.ConnRevision(integrationContext(t), "local", dbName, branchName)
	if err != nil {
		t.Fatalf("connect for column type lookup: %v", err)
	}
	defer conn.Close()

	rows, err := conn.QueryContext(integrationContext(t), fmt.Sprintf("SHOW COLUMNS FROM `%s`", tableName))
	if err != nil {
		t.Fatalf("show columns for %s/%s/%s: %v", dbName, branchName, tableName, err)
	}
	defer rows.Close()

	for rows.Next() {
		var field, colType, null, key string
		var defaultVal, extra any
		if err := rows.Scan(&field, &colType, &null, &key, &defaultVal, &extra); err != nil {
			t.Fatalf("scan column %s: %v", columnName, err)
		}
		if field == columnName {
			return colType
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate columns for %s/%s/%s: %v", dbName, branchName, tableName, err)
	}
	t.Fatalf("column %s not found in %s/%s/%s", columnName, dbName, branchName, tableName)
	return ""
}

func deleteBranchIfPresentInDB(t *testing.T, svc *Service, dbName, branchName string) {
	t.Helper()
	if !rawBranchExistsInDB(t, svc, dbName, branchName) {
		return
	}

	conn, err := svc.repo.ConnProtectedMaintenance(integrationContext(t), "local", dbName, "main")
	if err != nil {
		t.Fatalf("connect for branch cleanup: %v", err)
	}
	defer conn.Close()

	if _, err := conn.ExecContext(integrationContext(t), "CALL DOLT_BRANCH('-D', ?)", branchName); err != nil {
		t.Fatalf("delete branch %s: %v", branchName, err)
	}
}

func setCrossCopySchemaWidthInDB(t *testing.T, svc *Service, dbName string, width int) {
	t.Helper()

	conn, err := svc.repo.ConnProtectedMaintenance(integrationContext(t), "local", dbName, "main")
	if err != nil {
		t.Fatalf("connect for schema reset: %v", err)
	}
	defer conn.Close()

	for _, stmt := range []string{
		fmt.Sprintf("ALTER TABLE `zz_crosscopy_schema` MODIFY COLUMN `name` varchar(%d) NOT NULL", width),
		fmt.Sprintf("ALTER TABLE `zz_crosscopy_schema` MODIFY COLUMN `notes` varchar(%d) NULL", width),
	} {
		if _, err := conn.ExecContext(integrationContext(t), stmt); err != nil {
			t.Fatalf("apply schema width %d: %v", width, err)
		}
	}
	if _, err := conn.ExecContext(integrationContext(t), "CALL DOLT_ADD('.')"); err != nil {
		t.Fatalf("dolt add schema width %d: %v", width, err)
	}
	if _, err := conn.ExecContext(integrationContext(t), "CALL DOLT_COMMIT('--allow-empty', '-m', ?)", fmt.Sprintf("[test] reset zz_crosscopy_schema width to %d", width)); err != nil {
		t.Fatalf("dolt commit schema width %d: %v", width, err)
	}
}

func branchPresent(t *testing.T, svc *Service, branchName string) bool {
	t.Helper()
	return branchPresentInDB(t, svc, "test_db", branchName)
}

func requestCountInDB(t *testing.T, svc *Service, dbName string) int {
	t.Helper()
	requests, err := svc.ListRequests(integrationContext(t), "local", dbName)
	if err != nil {
		t.Fatalf("list requests: %v", err)
	}
	return len(requests)
}

func requestCount(t *testing.T, svc *Service) int {
	t.Helper()
	return requestCountInDB(t, svc, "test_db")
}

func TestMetadataPolicies_FilterAndRejectDisallowedBranches(t *testing.T) {
	svc := newIntegrationService(t)
	hiddenBranch := createHiddenBranch(t, svc, "test_db")

	branches, err := svc.ListBranches(integrationContext(t), "local", "test_db")
	if err != nil {
		t.Fatalf("list branches: %v", err)
	}
	for _, branch := range branches {
		if branch.Name == hiddenBranch {
			t.Fatalf("disallowed branch %s leaked into ListBranches", hiddenBranch)
		}
	}

	_, err = svc.GetHead(integrationContext(t), "local", "test_db", hiddenBranch)
	expectAPIErrorCode(t, err, model.CodeForbidden)

	_, err = svc.GetBranchReady(integrationContext(t), "local", "test_db", hiddenBranch)
	expectAPIErrorCode(t, err, model.CodeForbidden)
}

func TestHistoryCommits_RejectsDisallowedNamedBranch_ButAllowsTagOrHash(t *testing.T) {
	svc := newIntegrationService(t)
	hiddenBranch := createHiddenBranch(t, svc, "test_db")

	tagName := fmt.Sprintf("history-visible-%d", time.Now().UnixNano())
	createMainTag(t, svc, "test_db", tagName)

	if _, err := svc.HistoryCommits(integrationContext(t), "local", "test_db", tagName, 1, 20, "", "", "", "", "", ""); err != nil {
		t.Fatalf("history commits with tag ref: %v", err)
	}

	mainHead := mustHead(t, svc, "main")
	if _, err := svc.HistoryCommits(integrationContext(t), "local", "test_db", mainHead, 1, 20, "", "", "", "", "", ""); err != nil {
		t.Fatalf("history commits with commit hash ref: %v", err)
	}

	_, err := svc.HistoryCommits(integrationContext(t), "local", "test_db", hiddenBranch, 1, 20, "", "", "", "", "", "")
	expectAPIErrorCode(t, err, model.CodeForbidden)
}

func TestSearch_RejectsDisallowedBranch(t *testing.T) {
	svc := newIntegrationService(t)
	hiddenBranch := createHiddenBranch(t, svc, "test_db")

	_, err := svc.Search(integrationContext(t), "local", "test_db", hiddenBranch, "admin", false, 10)
	expectAPIErrorCode(t, err, model.CodeForbidden)
}

func TestBranchLifecycle_SubmitRejectResubmitApproveCreatesSequentialArchiveTags(t *testing.T) {
	svc := newIntegrationService(t)
	branchName := uniqueWorkBranch(t, "lifecycle")
	workItem, ok := workItemFromWorkBranch(branchName)
	if !ok {
		t.Fatalf("invalid work branch %s", branchName)
	}

	if err := svc.CreateBranch(integrationContext(t), model.CreateBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: branchName,
	}); err != nil {
		t.Fatalf("create branch: %v", err)
	}

	firstCommitHead := commitRoleChange(t, svc, branchName, "reviewer", "integration lifecycle commit 1")

	submitOne, err := svc.SubmitRequest(integrationContext(t), model.SubmitRequestRequest{
		TargetID:     "local",
		DBName:       "test_db",
		BranchName:   branchName,
		ExpectedHead: firstCommitHead,
		SummaryJa:    "integration request 1",
	})
	if err != nil {
		t.Fatalf("submit request 1: %v", err)
	}
	if submitOne.RequestID != requestIDFromWorkItem(workItem) {
		t.Fatalf("unexpected request id: %s", submitOne.RequestID)
	}

	_, err = svc.Commit(integrationContext(t), model.CommitRequest{
		TargetID:      "local",
		DBName:        "test_db",
		BranchName:    branchName,
		ExpectedHead:  mustHead(t, svc, branchName),
		CommitMessage: "blocked while locked",
		Ops: []model.CommitOp{
			{
				Type:  "update",
				Table: "users",
				PK:    map[string]interface{}{"id": 2},
				Values: map[string]interface{}{
					"role": "blocked",
				},
			},
		},
	})
	expectAPIErrorCode(t, err, model.CodeBranchLocked)

	_, err = svc.Sync(integrationContext(t), model.SyncRequest{
		TargetID:     "local",
		DBName:       "test_db",
		BranchName:   branchName,
		ExpectedHead: mustHead(t, svc, branchName),
	})
	expectAPIErrorCode(t, err, model.CodeBranchLocked)

	err = svc.DeleteBranch(integrationContext(t), model.DeleteBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: branchName,
	})
	expectAPIErrorCode(t, err, model.CodeBranchLocked)

	if _, err := svc.RejectRequest(integrationContext(t), model.RejectRequest{
		TargetID:  "local",
		DBName:    "test_db",
		RequestID: submitOne.RequestID,
	}); err != nil {
		t.Fatalf("reject request 1: %v", err)
	}
	if got := requestCount(t, svc); got != 0 {
		t.Fatalf("expected zero requests after reject, got %d", got)
	}

	secondSubmitHead, err := svc.SubmitRequest(integrationContext(t), model.SubmitRequestRequest{
		TargetID:     "local",
		DBName:       "test_db",
		BranchName:   branchName,
		ExpectedHead: mustHead(t, svc, branchName),
		SummaryJa:    "integration request 2",
	})
	if err != nil {
		t.Fatalf("resubmit request: %v", err)
	}

	approveOne, err := svc.ApproveRequest(integrationContext(t), model.ApproveRequest{
		TargetID:       "local",
		DBName:         "test_db",
		RequestID:      secondSubmitHead.RequestID,
		MergeMessageJa: "integration approve 1",
	})
	if err != nil {
		t.Fatalf("approve request 1: %v", err)
	}
	if !approveOne.ActiveBranchAdvanced {
		t.Fatalf("expected work branch to advance, warnings=%v", approveOne.Warnings)
	}
	if approveOne.ActiveBranch != branchName {
		t.Fatalf("unexpected active branch: %s", approveOne.ActiveBranch)
	}
	if approveOne.ArchiveTag != archiveTagForWorkItem(workItem, 1) {
		t.Fatalf("unexpected archive tag: %s", approveOne.ArchiveTag)
	}
	if got := requestCount(t, svc); got != 0 {
		t.Fatalf("expected no pending requests after approve, got %d", got)
	}
	if got, want := mustHead(t, svc, "main"), mustHead(t, svc, branchName); got != want {
		t.Fatalf("expected work branch head to match main after approve: main=%s branch=%s", got, want)
	}

	commitRoleChange(t, svc, branchName, "supervisor", "integration lifecycle commit 2")
	submitTwo, err := svc.SubmitRequest(integrationContext(t), model.SubmitRequestRequest{
		TargetID:     "local",
		DBName:       "test_db",
		BranchName:   branchName,
		ExpectedHead: mustHead(t, svc, branchName),
		SummaryJa:    "integration request 3",
	})
	if err != nil {
		t.Fatalf("submit request 3: %v", err)
	}

	approveTwo, err := svc.ApproveRequest(integrationContext(t), model.ApproveRequest{
		TargetID:       "local",
		DBName:         "test_db",
		RequestID:      submitTwo.RequestID,
		MergeMessageJa: "integration approve 2",
	})
	if err != nil {
		t.Fatalf("approve request 2: %v", err)
	}
	if approveTwo.ArchiveTag != archiveTagForWorkItem(workItem, 2) {
		t.Fatalf("unexpected second archive tag: %s", approveTwo.ArchiveTag)
	}

	wantTags := []string{
		archiveTagForWorkItem(workItem, 1),
		archiveTagForWorkItem(workItem, 2),
	}
	if got := archiveTagsForWorkItem(t, svc, workItem); fmt.Sprint(got) != fmt.Sprint(wantTags) {
		t.Fatalf("unexpected archive tags: got=%v want=%v", got, wantTags)
	}
}

func TestDeleteBranch_BlockedWhileRequestPendingAndSucceedsAfterReject(t *testing.T) {
	svc := newIntegrationService(t)
	branchName := uniqueWorkBranch(t, "delete")

	if err := svc.CreateBranch(integrationContext(t), model.CreateBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: branchName,
	}); err != nil {
		t.Fatalf("create branch: %v", err)
	}
	commitHead := commitRoleChange(t, svc, branchName, "auditor", "delete lifecycle commit")

	submitResp, err := svc.SubmitRequest(integrationContext(t), model.SubmitRequestRequest{
		TargetID:     "local",
		DBName:       "test_db",
		BranchName:   branchName,
		ExpectedHead: commitHead,
		SummaryJa:    "delete lifecycle request",
	})
	if err != nil {
		t.Fatalf("submit request: %v", err)
	}

	err = svc.DeleteBranch(integrationContext(t), model.DeleteBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: branchName,
	})
	expectAPIErrorCode(t, err, model.CodeBranchLocked)

	if _, err := svc.RejectRequest(integrationContext(t), model.RejectRequest{
		TargetID:  "local",
		DBName:    "test_db",
		RequestID: submitResp.RequestID,
	}); err != nil {
		t.Fatalf("reject request: %v", err)
	}

	if err := svc.DeleteBranch(integrationContext(t), model.DeleteBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: branchName,
	}); err != nil {
		t.Fatalf("delete branch after reject: %v", err)
	}
	if branchPresent(t, svc, branchName) {
		t.Fatalf("expected branch %s to be deleted", branchName)
	}
}

func TestGetBranchReady_ReturnsReadyAndNotFound(t *testing.T) {
	svc := newIntegrationService(t)
	branchName := uniqueWorkBranch(t, "ready")

	if err := svc.CreateBranch(integrationContext(t), model.CreateBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: branchName,
	}); err != nil {
		t.Fatalf("create branch: %v", err)
	}

	readyResp, err := svc.GetBranchReady(integrationContext(t), "local", "test_db", branchName)
	if err != nil {
		t.Fatalf("get branch ready: %v", err)
	}
	if !readyResp.Ready {
		t.Fatalf("expected branch %s to be ready", branchName)
	}

	_, err = svc.GetBranchReady(integrationContext(t), "local", "test_db", "wi/does-not-exist")
	expectAPIErrorCode(t, err, model.CodeNotFound)
}

func TestCreateBranch_DuplicateReturnsBranchExists(t *testing.T) {
	svc := newIntegrationService(t)
	branchName := uniqueWorkBranch(t, "duplicate")

	if err := svc.CreateBranch(integrationContext(t), model.CreateBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: branchName,
	}); err != nil {
		t.Fatalf("create branch: %v", err)
	}

	err := svc.CreateBranch(integrationContext(t), model.CreateBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: branchName,
	})
	expectAPIErrorCode(t, err, model.CodeBranchExists)
}

func TestCreateBranch_RejectsDisallowedBranch_WithoutCreatingIt(t *testing.T) {
	svc := newIntegrationService(t)
	hiddenBranch := fmt.Sprintf("scratch-create-%d", time.Now().UnixNano())

	err := svc.CreateBranch(integrationContext(t), model.CreateBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: hiddenBranch,
	})
	expectAPIErrorCode(t, err, model.CodeInvalidArgument)

	if rawBranchExistsInDB(t, svc, "test_db", hiddenBranch) {
		t.Fatalf("disallowed branch %s should not have been created", hiddenBranch)
	}
}

func TestDeleteBranch_RejectsDisallowedHiddenBranch(t *testing.T) {
	svc := newIntegrationService(t)
	hiddenBranch := createHiddenBranch(t, svc, "test_db")

	err := svc.DeleteBranch(integrationContext(t), model.DeleteBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: hiddenBranch,
	})
	expectAPIErrorCode(t, err, model.CodeInvalidArgument)

	if !rawBranchExistsInDB(t, svc, "test_db", hiddenBranch) {
		t.Fatalf("hidden branch %s should still exist after rejected delete", hiddenBranch)
	}
}

func TestCrossCopyTable_SubmitApproveUsesLongLivedImportBranch(t *testing.T) {
	svc := newIntegrationService(t)
	importBranch := importWorkBranchName("test_db", "users")

	copyResp, err := svc.CrossCopyTable(integrationContext(t), model.CrossCopyTableRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "main",
		SourceTable:  "users",
		DestDB:       "dest_db",
	})
	if err != nil {
		t.Fatalf("cross copy table: %v", err)
	}
	if copyResp.BranchName != importBranch {
		t.Fatalf("unexpected import branch: got %s want %s", copyResp.BranchName, importBranch)
	}
	if !branchPresentInDB(t, svc, "dest_db", importBranch) {
		t.Fatalf("expected import branch %s to exist", importBranch)
	}

	submitResp, err := svc.SubmitRequest(integrationContext(t), model.SubmitRequestRequest{
		TargetID:     "local",
		DBName:       "dest_db",
		BranchName:   importBranch,
		ExpectedHead: mustHeadInDB(t, svc, "dest_db", importBranch),
		SummaryJa:    "cross copy import request",
	})
	if err != nil {
		t.Fatalf("submit cross copy request: %v", err)
	}

	approveResp, err := svc.ApproveRequest(integrationContext(t), model.ApproveRequest{
		TargetID:       "local",
		DBName:         "dest_db",
		RequestID:      submitResp.RequestID,
		MergeMessageJa: "cross copy import approve",
	})
	if err != nil {
		t.Fatalf("approve cross copy request: %v", err)
	}
	if !approveResp.ActiveBranchAdvanced {
		t.Fatalf("expected import branch to advance, warnings=%v", approveResp.Warnings)
	}
	if got, want := mustHeadInDB(t, svc, "dest_db", "main"), mustHeadInDB(t, svc, "dest_db", importBranch); got != want {
		t.Fatalf("expected import branch head to match main after approve: main=%s branch=%s", got, want)
	}

	_, copyAgainErr := svc.CrossCopyTable(integrationContext(t), model.CrossCopyTableRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "main",
		SourceTable:  "users",
		DestDB:       "dest_db",
	})
	expectAPIErrorCode(t, copyAgainErr, model.CodeBranchExists)
}

func TestCrossCopyAdminPrepareRows_EnablesRetryOnSchemaMismatch(t *testing.T) {
	svc := newIntegrationService(t)
	destBranch := uniqueWorkBranch(t, "admin-copy")
	setCrossCopySchemaWidthInDB(t, svc, "dest_db", 50)
	t.Cleanup(func() {
		setCrossCopySchemaWidthInDB(t, svc, "dest_db", 50)
	})

	if err := svc.CreateBranch(integrationContext(t), model.CreateBranchRequest{
		TargetID:   "local",
		DBName:     "dest_db",
		BranchName: destBranch,
	}); err != nil {
		t.Fatalf("create dest branch: %v", err)
	}

	previewBefore, err := svc.CrossCopyPreview(integrationContext(t), model.CrossCopyPreviewRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "main",
		SourceTable:  "zz_crosscopy_schema",
		SourcePKs:    []string{`{"id":1}`},
		DestDB:       "dest_db",
		DestBranch:   destBranch,
	})
	if err != nil {
		t.Fatalf("preview before admin prep: %v", err)
	}
	if len(previewBefore.ExpandColumns) == 0 {
		t.Fatal("expected schema mismatch before admin prep")
	}

	prepareResp, err := svc.CrossCopyAdminPrepareRows(integrationContext(t), model.CrossCopyAdminPrepareRowsRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "main",
		SourceTable:  "zz_crosscopy_schema",
		DestDB:       "dest_db",
		DestBranch:   destBranch,
	})
	if err != nil {
		t.Fatalf("admin prepare rows: %v", err)
	}
	if prepareResp.Outcome != model.OperationOutcomeCompleted {
		t.Fatalf("expected completed outcome, got %s", prepareResp.Outcome)
	}
	if got := columnTypeInDB(t, svc, "dest_db", "main", "zz_crosscopy_schema", "name"); got != "varchar(255)" {
		t.Fatalf("expected dest main schema to be widened, got %s", got)
	}
	if got := columnTypeInDB(t, svc, "dest_db", destBranch, "zz_crosscopy_schema", "name"); got != "varchar(255)" {
		t.Fatalf("expected dest branch schema to be widened, got %s", got)
	}

	previewAfter, err := svc.CrossCopyPreview(integrationContext(t), model.CrossCopyPreviewRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "main",
		SourceTable:  "zz_crosscopy_schema",
		SourcePKs:    []string{`{"id":1}`},
		DestDB:       "dest_db",
		DestBranch:   destBranch,
	})
	if err != nil {
		t.Fatalf("preview after admin prep: %v", err)
	}
	if len(previewAfter.ExpandColumns) != 0 {
		t.Fatalf("expected no expand columns after admin prep, got %d", len(previewAfter.ExpandColumns))
	}

	copyResp, err := svc.CrossCopyRows(integrationContext(t), model.CrossCopyRowsRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "main",
		SourceTable:  "zz_crosscopy_schema",
		SourcePKs:    []string{`{"id":1}`},
		DestDB:       "dest_db",
		DestBranch:   destBranch,
	})
	if err != nil {
		t.Fatalf("cross copy rows after admin prep: %v", err)
	}
	if copyResp.Outcome != model.OperationOutcomeCompleted {
		t.Fatalf("expected completed row copy, got %s", copyResp.Outcome)
	}
}

func TestCrossCopyAdminPrepareTable_EnablesSubsequentTableCopy(t *testing.T) {
	svc := newIntegrationService(t)
	importBranch := importWorkBranchName("test_db", "zz_crosscopy_schema")
	setCrossCopySchemaWidthInDB(t, svc, "dest_db", 50)
	t.Cleanup(func() {
		setCrossCopySchemaWidthInDB(t, svc, "dest_db", 50)
	})
	deleteBranchIfPresentInDB(t, svc, "dest_db", importBranch)
	t.Cleanup(func() {
		deleteBranchIfPresentInDB(t, svc, "dest_db", importBranch)
	})

	prepareResp, err := svc.CrossCopyAdminPrepareTable(integrationContext(t), model.CrossCopyAdminPrepareTableRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "main",
		SourceTable:  "zz_crosscopy_schema",
		DestDB:       "dest_db",
	})
	if err != nil {
		t.Fatalf("admin prepare table: %v", err)
	}
	if prepareResp.Outcome != model.OperationOutcomeCompleted {
		t.Fatalf("expected completed outcome, got %s", prepareResp.Outcome)
	}
	if got := columnTypeInDB(t, svc, "dest_db", "main", "zz_crosscopy_schema", "name"); got != "varchar(255)" {
		t.Fatalf("expected dest main schema to be widened, got %s", got)
	}

	copyResp, err := svc.CrossCopyTable(integrationContext(t), model.CrossCopyTableRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "main",
		SourceTable:  "zz_crosscopy_schema",
		DestDB:       "dest_db",
	})
	if err != nil {
		t.Fatalf("cross copy table after admin prep: %v", err)
	}
	if copyResp.Outcome != model.OperationOutcomeCompleted {
		t.Fatalf("expected completed table copy, got %s", copyResp.Outcome)
	}
	if copyResp.BranchName != importBranch {
		t.Fatalf("unexpected import branch: got %s want %s", copyResp.BranchName, importBranch)
	}
}

func TestCrossCopyAdminCleanupImport_DeletesDeterministicBranch(t *testing.T) {
	svc := newIntegrationService(t)
	importBranch := importWorkBranchName("test_db", "zz_crosscopy_schema")
	deleteBranchIfPresentInDB(t, svc, "dest_db", importBranch)

	conn, err := svc.repo.ConnProtectedMaintenance(integrationContext(t), "local", "dest_db", "main")
	if err != nil {
		t.Fatalf("connect for import branch create: %v", err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(integrationContext(t), "CALL DOLT_BRANCH(?)", importBranch); err != nil {
		t.Fatalf("create import branch: %v", err)
	}

	resp, err := svc.CrossCopyAdminCleanupImport(integrationContext(t), model.CrossCopyAdminCleanupImportRequest{
		TargetID:   "local",
		DestDB:     "dest_db",
		BranchName: importBranch,
	})
	if err != nil {
		t.Fatalf("cleanup import branch: %v", err)
	}
	if resp.Outcome != model.OperationOutcomeCompleted {
		t.Fatalf("expected completed outcome, got %s", resp.Outcome)
	}
	if rawBranchExistsInDB(t, svc, "dest_db", importBranch) {
		t.Fatalf("expected import branch %s to be removed", importBranch)
	}
}

func TestCrossCopyPreview_AllowsAuditSourceBranch(t *testing.T) {
	svc := newIntegrationService(t)
	destBranch := uniqueWorkBranch(t, "audit-copy")

	if err := svc.CreateBranch(integrationContext(t), model.CreateBranchRequest{
		TargetID:   "local",
		DBName:     "dest_db",
		BranchName: destBranch,
	}); err != nil {
		t.Fatalf("create dest branch: %v", err)
	}

	previewResp, err := svc.CrossCopyPreview(integrationContext(t), model.CrossCopyPreviewRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "audit",
		SourceTable:  "users",
		SourcePKs:    []string{`{"id":1}`},
		DestDB:       "dest_db",
		DestBranch:   destBranch,
	})
	if err != nil {
		t.Fatalf("cross copy preview from audit: %v", err)
	}
	if len(previewResp.Rows) != 1 {
		t.Fatalf("expected one preview row, got %d", len(previewResp.Rows))
	}
}

func TestCrossCopyRejectsWorkBranchSource(t *testing.T) {
	svc := newIntegrationService(t)
	destBranch := uniqueWorkBranch(t, "copy-dest")

	if err := svc.CreateBranch(integrationContext(t), model.CreateBranchRequest{
		TargetID:   "local",
		DBName:     "dest_db",
		BranchName: destBranch,
	}); err != nil {
		t.Fatalf("create dest branch: %v", err)
	}

	previewErr := func() error {
		_, err := svc.CrossCopyPreview(integrationContext(t), model.CrossCopyPreviewRequest{
			TargetID:     "local",
			SourceDB:     "test_db",
			SourceBranch: "wi/not-allowed",
			SourceTable:  "users",
			SourcePKs:    []string{`{"id":1}`},
			DestDB:       "dest_db",
			DestBranch:   destBranch,
		})
		return err
	}()
	expectAPIErrorCode(t, previewErr, model.CodeInvalidArgument)

	rowsErr := func() error {
		_, err := svc.CrossCopyRows(integrationContext(t), model.CrossCopyRowsRequest{
			TargetID:     "local",
			SourceDB:     "test_db",
			SourceBranch: "wi/not-allowed",
			SourceTable:  "users",
			SourcePKs:    []string{`{"id":1}`},
			DestDB:       "dest_db",
			DestBranch:   destBranch,
		})
		return err
	}()
	expectAPIErrorCode(t, rowsErr, model.CodeInvalidArgument)

	tableErr := func() error {
		_, err := svc.CrossCopyTable(integrationContext(t), model.CrossCopyTableRequest{
			TargetID:     "local",
			SourceDB:     "test_db",
			SourceBranch: "wi/not-allowed",
			SourceTable:  "users",
			DestDB:       "dest_db",
		})
		return err
	}()
	expectAPIErrorCode(t, tableErr, model.CodeInvalidArgument)
}

func TestCrossCopyRejectsNonWorkDestinationBranch(t *testing.T) {
	svc := newIntegrationService(t)

	previewErr := func() error {
		_, err := svc.CrossCopyPreview(integrationContext(t), model.CrossCopyPreviewRequest{
			TargetID:     "local",
			SourceDB:     "test_db",
			SourceBranch: "main",
			SourceTable:  "users",
			SourcePKs:    []string{`{"id":1}`},
			DestDB:       "dest_db",
			DestBranch:   "scratch-not-allowed",
		})
		return err
	}()
	expectAPIErrorCode(t, previewErr, model.CodeInvalidArgument)

	rowsErr := func() error {
		_, err := svc.CrossCopyRows(integrationContext(t), model.CrossCopyRowsRequest{
			TargetID:     "local",
			SourceDB:     "test_db",
			SourceBranch: "main",
			SourceTable:  "users",
			SourcePKs:    []string{`{"id":1}`},
			DestDB:       "dest_db",
			DestBranch:   "scratch-not-allowed",
		})
		return err
	}()
	expectAPIErrorCode(t, rowsErr, model.CodeInvalidArgument)
}

func TestApproveRequest_ContinuesWithDegradedReqMessageJSON(t *testing.T) {
	svc := newIntegrationService(t)
	branchName := uniqueWorkBranch(t, "degraded-approve")

	if err := svc.CreateBranch(integrationContext(t), model.CreateBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: branchName,
	}); err != nil {
		t.Fatalf("create branch: %v", err)
	}

	commitHead := commitRoleChange(t, svc, branchName, "degraded-approve", "integration degraded approve")
	submitResp, err := svc.SubmitRequest(integrationContext(t), model.SubmitRequestRequest{
		TargetID:     "local",
		DBName:       "test_db",
		BranchName:   branchName,
		ExpectedHead: commitHead,
		SummaryJa:    "degraded request json",
	})
	if err != nil {
		t.Fatalf("submit request: %v", err)
	}

	replaceTagMessageInDB(t, svc, "test_db", submitResp.RequestID, submitResp.SubmittedWorkHash, "{broken-json")

	approveResp, err := svc.ApproveRequest(integrationContext(t), model.ApproveRequest{
		TargetID:       "local",
		DBName:         "test_db",
		RequestID:      submitResp.RequestID,
		MergeMessageJa: "integration degraded approve merge",
	})
	if err != nil {
		t.Fatalf("approve degraded req json: %v", err)
	}
	if approveResp.Outcome != model.OperationOutcomeCompleted {
		t.Fatalf("expected completed outcome, got %s", approveResp.Outcome)
	}
	if got := requestCount(t, svc); got != 0 {
		t.Fatalf("expected request cleanup after approve, got %d pending", got)
	}

	message := commitMessageInDB(t, svc, "test_db", approveResp.Hash)
	footer, err := parseApprovalFooter(message)
	if err != nil {
		t.Fatalf("parse approval footer: %v", err)
	}
	if footer == nil {
		t.Fatal("expected approval footer")
	}
	if footer.RequestID != submitResp.RequestID {
		t.Fatalf("unexpected request id in footer: got %s want %s", footer.RequestID, submitResp.RequestID)
	}
	if footer.WorkBranch != branchName {
		t.Fatalf("unexpected work branch in footer: got %s want %s", footer.WorkBranch, branchName)
	}
	if footer.SubmittedWorkHash != submitResp.SubmittedWorkHash {
		t.Fatalf("unexpected submitted work hash in footer: got %s want %s", footer.SubmittedWorkHash, submitResp.SubmittedWorkHash)
	}
}

func TestHistoryCommits_FooterFirst_ReadsPostCutoverWithoutMergedTag(t *testing.T) {
	svc := newIntegrationService(t)
	branchName := uniqueWorkBranch(t, "history-footer")

	if err := svc.CreateBranch(integrationContext(t), model.CreateBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: branchName,
	}); err != nil {
		t.Fatalf("create branch: %v", err)
	}

	commitHead := commitRoleChange(t, svc, branchName, "history-footer", "integration history footer")
	submitResp, err := svc.SubmitRequest(integrationContext(t), model.SubmitRequestRequest{
		TargetID:     "local",
		DBName:       "test_db",
		BranchName:   branchName,
		ExpectedHead: commitHead,
		SummaryJa:    "history footer request",
	})
	if err != nil {
		t.Fatalf("submit request: %v", err)
	}

	approveResp, err := svc.ApproveRequest(integrationContext(t), model.ApproveRequest{
		TargetID:       "local",
		DBName:         "test_db",
		RequestID:      submitResp.RequestID,
		MergeMessageJa: "integration history footer merge",
	})
	if err != nil {
		t.Fatalf("approve request: %v", err)
	}
	if approveResp.ArchiveTag == "" {
		t.Fatal("expected archive tag for secondary index")
	}

	deleteTagInDB(t, svc, "test_db", approveResp.ArchiveTag)

	historyResp, err := svc.HistoryCommits(integrationContext(t), "local", "test_db", "main", 1, 20, "", "", "", "", "", "")
	if err != nil {
		t.Fatalf("history commits after archive tag delete: %v", err)
	}
	if historyResp.ReadIntegrity != model.ReadIntegrityComplete {
		t.Fatalf("expected read_integrity=%s, got %s", model.ReadIntegrityComplete, historyResp.ReadIntegrity)
	}

	found := false
	for _, commit := range historyResp.Commits {
		if commit.Hash == approveResp.Hash {
			found = true
			if commit.MergeBranch != branchName {
				t.Fatalf("unexpected merge branch: got %s want %s", commit.MergeBranch, branchName)
			}
		}
	}
	if !found {
		t.Fatalf("expected approved commit %s in history after merged/* deletion", approveResp.Hash)
	}
}
