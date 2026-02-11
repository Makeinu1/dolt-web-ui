package handler

import (
	"net/http"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func (h *Handler) ListConflicts(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("target_id")
	dbName := r.URL.Query().Get("db_name")
	branchName := r.URL.Query().Get("branch_name")
	if targetID == "" || dbName == "" || branchName == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, and branch_name are required")
		return
	}

	conflicts, err := h.svc.ListConflicts(r.Context(), targetID, dbName, branchName)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, conflicts)
}

func (h *Handler) GetConflictsTable(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("target_id")
	dbName := r.URL.Query().Get("db_name")
	branchName := r.URL.Query().Get("branch_name")
	table := r.URL.Query().Get("table")
	if targetID == "" || dbName == "" || branchName == "" || table == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, branch_name, and table are required")
		return
	}

	conflicts, err := h.svc.GetConflictsTable(r.Context(), targetID, dbName, branchName, table)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, conflicts)
}

func (h *Handler) ResolveConflicts(w http.ResponseWriter, r *http.Request) {
	var req model.ResolveConflictsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}

	if req.TargetID == "" || req.DBName == "" || req.BranchName == "" || req.Table == "" || req.Strategy == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, branch_name, table, and strategy are required")
		return
	}

	if mainGuard(w, req.BranchName) {
		return
	}

	result, err := h.svc.ResolveConflicts(r.Context(), req)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
