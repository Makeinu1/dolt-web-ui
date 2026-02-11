package handler

import (
	"encoding/json"
	"net/http"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/config"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/service"
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
		r.Post("/branches/create", h.CreateBranch)
		r.Get("/head", h.GetHead)

		// Tables
		r.Get("/tables", h.ListTables)
		r.Get("/table/schema", h.GetTableSchema)
		r.Get("/table/rows", h.GetTableRows)
		r.Get("/table/row", h.GetTableRow)

		// Previews
		r.Post("/preview/clone", h.PreviewClone)
		r.Post("/preview/batch_generate", h.PreviewBatchGenerate)
		r.Post("/preview/bulk_update", h.PreviewBulkUpdate)

		// Write operations
		r.Post("/commit", h.Commit)
		r.Post("/sync", h.Sync)

		// Diff & History
		r.Get("/diff/table", h.DiffTable)
		r.Get("/history/commits", h.HistoryCommits)
		r.Get("/history/row", h.HistoryRow)

		// Conflicts
		r.Get("/conflicts", h.ListConflicts)
		r.Get("/conflicts/table", h.GetConflictsTable)
		r.Post("/conflicts/resolve", h.ResolveConflicts)

		// Request/Approval
		r.Post("/request/submit", h.SubmitRequest)
		r.Get("/requests", h.ListRequests)
		r.Get("/request", h.GetRequest)
		r.Post("/request/approve", h.ApproveRequest)
		r.Post("/request/reject", h.RejectRequest)
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

// mainGuard returns true (and writes 403) if branchName is "main".
// Per v6f spec: main branch is read-only for all write operations.
func mainGuard(w http.ResponseWriter, branchName string) bool {
	if branchName == "main" {
		writeErrorWithDetails(w, http.StatusForbidden, model.CodeForbidden,
			"write operations on main branch are forbidden",
			map[string]string{"reason": "main_guard", "branch": "main"})
		return true
	}
	return false
}
