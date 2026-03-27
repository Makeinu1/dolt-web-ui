package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func (h *Handler) SyncBranch(w http.ResponseWriter, r *http.Request) {
	var req model.SyncRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}
	if req.TargetID == "" || req.DBName == "" || req.BranchName == "" || req.ExpectedHead == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, branch_name, expected_head are required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	result, err := h.svc.Sync(ctx, req)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
