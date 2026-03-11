package service

import (
	"context"
	"database/sql/driver"
	"errors"
	"testing"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/config"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func expectUnitAPIErrorCode(t *testing.T, err error, code string) {
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

func testServiceConfigWithoutWorkBranches() *config.Config {
	return &config.Config{
		Targets: []config.Target{
			{ID: "local"},
		},
		Databases: []config.Database{
			{
				TargetID:        "local",
				Name:            "test_db",
				AllowedBranches: []string{"main", "audit"},
			},
		},
		Server: config.Server{
			Recovery: config.Recovery{
				BranchReadySec:    1,
				BranchReadyPollMS: 1,
			},
			Search: config.Search{
				TimeoutSec: 1,
			},
		},
	}
}

func TestWorkBranchMutations_RejectConfigDisallowedBranch_BeforeWriteSession(t *testing.T) {
	tests := []struct {
		name string
		run  func(*Service) error
	}{
		{
			name: "Commit",
			run: func(svc *Service) error {
				_, err := svc.Commit(context.Background(), model.CommitRequest{
					TargetID:      "local",
					DBName:        "test_db",
					BranchName:    "wi/disallowed",
					ExpectedHead:  "head",
					CommitMessage: "msg",
					Ops: []model.CommitOp{
						{
							Type:   "insert",
							Table:  "users",
							Values: map[string]interface{}{"id": 99},
						},
					},
				})
				return err
			},
		},
		{
			name: "SubmitRequest",
			run: func(svc *Service) error {
				_, err := svc.SubmitRequest(context.Background(), model.SubmitRequestRequest{
					TargetID:     "local",
					DBName:       "test_db",
					BranchName:   "wi/disallowed",
					ExpectedHead: "head",
					SummaryJa:    "summary",
				})
				return err
			},
		},
		{
			name: "CSVApply",
			run: func(svc *Service) error {
				_, err := svc.CSVApply(context.Background(), model.CSVApplyRequest{
					TargetID:     "local",
					DBName:       "test_db",
					BranchName:   "wi/disallowed",
					ExpectedHead: "head",
					Table:        "users",
					Rows: []map[string]interface{}{
						{"id": 1, "name": "hidden"},
					},
				})
				return err
			},
		},
		{
			name: "Sync",
			run: func(svc *Service) error {
				_, err := svc.Sync(context.Background(), model.SyncRequest{
					TargetID:     "local",
					DBName:       "test_db",
					BranchName:   "wi/disallowed",
					ExpectedHead: "head",
				})
				return err
			},
		},
		{
			name: "AbortMerge",
			run: func(svc *Service) error {
				return svc.AbortMerge(context.Background(), "local", "test_db", "wi/disallowed")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
				t.Fatalf("unexpected revision query on ref %s: %s", refName, query)
				return testQueryResult{}, nil
			})
			svc := newWithDeps(repo, testServiceConfigWithoutWorkBranches())

			err := tt.run(svc)
			expectUnitAPIErrorCode(t, err, model.CodeForbidden)
			if len(repo.calls) != 0 {
				t.Fatalf("expected no repository sessions, got %v", repo.calls)
			}
		})
	}
}

func TestCreateBranch_RejectsConfigDisallowedWorkBranch_BeforeMaintenanceSession(t *testing.T) {
	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		t.Fatalf("unexpected revision query on ref %s: %s", refName, query)
		return testQueryResult{}, nil
	})
	svc := newWithDeps(repo, testServiceConfigWithoutWorkBranches())

	err := svc.CreateBranch(context.Background(), model.CreateBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: "wi/disallowed",
	})
	expectUnitAPIErrorCode(t, err, model.CodeForbidden)
	if len(repo.calls) != 0 {
		t.Fatalf("expected no repository sessions, got %v", repo.calls)
	}
}

func TestDeleteBranch_RejectsConfigDisallowedWorkBranch_BeforeMaintenanceSession(t *testing.T) {
	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		t.Fatalf("unexpected revision query on ref %s: %s", refName, query)
		return testQueryResult{}, nil
	})
	svc := newWithDeps(repo, testServiceConfigWithoutWorkBranches())

	err := svc.DeleteBranch(context.Background(), model.DeleteBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: "wi/disallowed",
	})
	expectUnitAPIErrorCode(t, err, model.CodeForbidden)
	if len(repo.calls) != 0 {
		t.Fatalf("expected no repository sessions, got %v", repo.calls)
	}
}
