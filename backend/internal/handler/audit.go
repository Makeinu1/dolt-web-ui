package handler

import (
	"net/http"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

// AuditMerge handles POST /audit-merge: merges audit → main with memo protection.
func (h *Handler) AuditMerge(w http.ResponseWriter, r *http.Request) {
	var req model.AuditMergeRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}
	if req.TargetID == "" || req.DBName == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id and db_name are required")
		return
	}

	resp, err := h.svc.AuditMerge(r.Context(), req)
	if err != nil {
		if apiErr, ok := err.(*model.APIError); ok {
			writeError(w, apiErr.Status, apiErr.Code, apiErr.Msg)
			return
		}
		writeError(w, http.StatusInternalServerError, model.CodeInternal, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}
