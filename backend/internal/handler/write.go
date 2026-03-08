package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func (h *Handler) Commit(w http.ResponseWriter, r *http.Request) {
	var req model.CommitRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}

	if req.TargetID == "" || req.DBName == "" || req.BranchName == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id, db_name, and branch_name are required")
		return
	}

	if mainGuard(w, req.BranchName) {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	result, err := h.svc.Commit(ctx, req)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// MergeAbort L3-2: Escape hatch to abort a stuck merge state.
func (h *Handler) MergeAbort(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TargetID   string `json:"target_id"`
		DBName     string `json:"db_name"`
		BranchName string `json:"branch_name"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}
	if req.TargetID == "" || req.DBName == "" || req.BranchName == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id, db_name, and branch_name are required")
		return
	}
	if mainGuard(w, req.BranchName) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	if err := h.svc.AbortMerge(ctx, req.TargetID, req.DBName, req.BranchName); err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
