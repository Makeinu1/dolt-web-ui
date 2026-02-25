package handler

import (
	"encoding/json"
	"net/http"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

// Revert handles reverting a specific commit.
func (h *Handler) Revert(w http.ResponseWriter, r *http.Request) {
	var req model.RevertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}
	defer r.Body.Close()

	if mainGuard(w, req.BranchName) {
		return
	}

	res, err := h.svc.Revert(r.Context(), req)
	if err != nil {
		if apiErr, ok := err.(*model.APIError); ok {
			writeErrorWithDetails(w, apiErr.Status, apiErr.Code, apiErr.Msg, apiErr.Details)
		} else {
			writeError(w, http.StatusInternalServerError, model.CodeInternal, err.Error())
		}
		return
	}

	writeJSON(w, http.StatusOK, res)
}
