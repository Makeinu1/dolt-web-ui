package handler

import (
	"net/http"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func (h *Handler) CSVPreview(w http.ResponseWriter, r *http.Request) {
	var req model.CSVPreviewRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}
	if req.TargetID == "" || req.DBName == "" || req.BranchName == "" || req.Table == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id, db_name, branch_name, and table are required")
		return
	}
	if mainGuard(w, req.BranchName) {
		return
	}
	result, err := h.svc.CSVPreview(r.Context(), req)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) CSVApply(w http.ResponseWriter, r *http.Request) {
	var req model.CSVApplyRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}
	if req.TargetID == "" || req.DBName == "" || req.BranchName == "" || req.Table == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id, db_name, branch_name, and table are required")
		return
	}
	if mainGuard(w, req.BranchName) {
		return
	}
	result, err := h.svc.CSVApply(r.Context(), req)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
