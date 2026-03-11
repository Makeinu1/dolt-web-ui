package handler

import (
	"encoding/json"
	"net/http"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/config"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/service"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
	"github.com/go-chi/chi/v5"
)

// Handler holds dependencies for HTTP handlers.
type Handler struct {
	svc *service.Service
	cfg *config.Config
}

// Register sets up all API routes.
func Register(r chi.Router, svc *service.Service, cfg *config.Config) {
	h := &Handler{svc: svc, cfg: cfg}

	r.Route("/api/v1", func(r chi.Router) {
		// Metadata
		r.Get("/targets", h.ListTargets)
		r.Get("/databases", h.ListDatabases)
		r.Get("/branches", h.ListBranches)
		r.Get("/branches/ready", h.GetBranchReady)
		r.Post("/branches/create", h.CreateBranch)
		r.Post("/branches/delete", h.DeleteBranch)
		r.Get("/head", h.GetHead)

		// Tables
		r.Get("/tables", h.ListTables)
		r.Get("/table/schema", h.GetTableSchema)
		r.Get("/table/rows", h.GetTableRows)
		r.Get("/table/row", h.GetTableRow)

		// Previews
		r.Post("/preview/clone", h.PreviewClone)

		// Write operations
		r.Post("/commit", h.Commit)
		r.Post("/merge/abort", h.MergeAbort) // L3-2: escape hatch for stuck merges

		// Diff & History
		r.Get("/diff/table", h.DiffTable)
		r.Get("/diff/summary", h.DiffSummary)
		r.Get("/diff/export-zip", h.ExportDiffZip)
		r.Get("/history/commits", h.HistoryCommits)
		r.Get("/history/row", h.HistoryRow)

		// Request/Approval
		r.Post("/request/submit", h.SubmitRequest)
		r.Get("/requests", h.ListRequests)
		r.Get("/request", h.GetRequest)
		r.Post("/request/approve", h.ApproveRequest)
		r.Post("/request/reject", h.RejectRequest)

		// Cell Memos
		r.Get("/memo", h.GetMemo)
		r.Get("/memo/map", h.GetMemoMap)

		// Cross-DB Copy
		r.Post("/cross-copy/preview", h.CrossCopyPreview)
		r.Post("/cross-copy/rows", h.CrossCopyRows)
		r.Post("/cross-copy/table", h.CrossCopyTable)

		// CSV Import
		r.Post("/csv/preview", h.CSVPreview)
		r.Post("/csv/apply", h.CSVApply)

		// Search
		r.Get("/search", h.Search)
	})

	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, model.NewError(code, message, nil))
}

func writeErrorWithDetails(w http.ResponseWriter, status int, code, message string, details interface{}) {
	writeJSON(w, status, model.NewError(code, message, details))
}

func decodeJSON(r *http.Request, v interface{}) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

// parseQueryContext extracts target_id, db_name, and branch_name from query params.
// Returns ok=false (and writes a 400 error) if any required param is missing.
func parseQueryContext(w http.ResponseWriter, r *http.Request) (targetID, dbName, branchName string, ok bool) {
	targetID = r.URL.Query().Get("target_id")
	dbName = r.URL.Query().Get("db_name")
	branchName = r.URL.Query().Get("branch_name")
	if targetID == "" || dbName == "" || branchName == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, and branch_name are required")
		return "", "", "", false
	}
	return targetID, dbName, branchName, true
}

// mainGuard returns true (and writes 403) if branchName is protected.
// Per v6f spec: main and audit branches are read-only for all write operations.
func mainGuard(w http.ResponseWriter, branchName string) bool {
	if validation.IsProtectedBranch(branchName) {
		writeErrorWithDetails(w, http.StatusForbidden, model.CodeForbidden,
			"write operations on protected branch are forbidden",
			map[string]string{"reason": "protected_branch_guard", "branch": branchName})
		return true
	}
	return false
}
