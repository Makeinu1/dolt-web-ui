//go:build integration

package service

import (
	"testing"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func TestMemo_CommitAndApprove_PersistsToMain(t *testing.T) {
	svc := newIntegrationService(t)
	branchName := uniqueWorkBranch(t, "memo")

	if err := svc.CreateBranch(integrationContext(t), model.CreateBranchRequest{
		TargetID:   "local",
		DBName:     "test_db",
		BranchName: branchName,
	}); err != nil {
		t.Fatalf("create branch: %v", err)
	}

	commitResp, err := svc.Commit(integrationContext(t), model.CommitRequest{
		TargetID:      "local",
		DBName:        "test_db",
		BranchName:    branchName,
		ExpectedHead:  mustHead(t, svc, branchName),
		CommitMessage: "integration memo commit",
		Ops: []model.CommitOp{
			{
				Type:  "insert",
				Table: "_memo_users",
				Values: map[string]interface{}{
					"pk_value":    `{"id":1}`,
					"column_name": "role",
					"memo_text":   "integration memo",
					"updated_at":  "2026-03-13 12:00:00",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("commit memo: %v", err)
	}

	workMemo, err := svc.GetMemo(integrationContext(t), "local", "test_db", branchName, "users", `{"id":1}`, "role")
	if err != nil {
		t.Fatalf("get memo on work branch: %v", err)
	}
	if workMemo.MemoText != "integration memo" {
		t.Fatalf("unexpected work-branch memo: %q", workMemo.MemoText)
	}

	submitResp, err := svc.SubmitRequest(integrationContext(t), model.SubmitRequestRequest{
		TargetID:     "local",
		DBName:       "test_db",
		BranchName:   branchName,
		ExpectedHead: commitResp.Hash,
		SummaryJa:    "integration memo request",
	})
	if err != nil {
		t.Fatalf("submit request: %v", err)
	}

	if _, err := svc.ApproveRequest(integrationContext(t), model.ApproveRequest{
		TargetID:       "local",
		DBName:         "test_db",
		RequestID:      submitResp.RequestID,
		MergeMessageJa: "integration memo approve",
	}); err != nil {
		t.Fatalf("approve request: %v", err)
	}

	mainMemo, err := svc.GetMemo(integrationContext(t), "local", "test_db", "main", "users", `{"id":1}`, "role")
	if err != nil {
		t.Fatalf("get memo on main: %v", err)
	}
	if mainMemo.MemoText != "integration memo" {
		t.Fatalf("unexpected main memo: %q", mainMemo.MemoText)
	}
}
