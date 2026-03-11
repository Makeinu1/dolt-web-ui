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

func archiveTagsForWorkItemInDB(t *testing.T, svc *Service, dbName, workItem string) []string {
	t.Helper()
	conn, err := svc.repo.ConnDB(integrationContext(t), "local", dbName)
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

	if err := svc.RejectRequest(integrationContext(t), model.RejectRequest{
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

	if err := svc.RejectRequest(integrationContext(t), model.RejectRequest{
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
