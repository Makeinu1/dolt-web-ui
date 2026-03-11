package handler

import (
	"net/http"
	"strconv"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

// Search handles GET /api/v1/search
// Params: target_id, db_name, branch_name, keyword, include_memo (optional), limit (optional, default 100)
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	targetID := q.Get("target_id")
	dbName := q.Get("db_name")
	branchName := q.Get("branch_name")
	keyword := q.Get("keyword")

	if targetID == "" || dbName == "" || branchName == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, and branch_name are required")
		return
	}
	if keyword == "" {
		writeJSON(w, http.StatusOK, model.SearchResponse{
			Results: []model.SearchResult{},
			Total:   0,
			ReadResultFields: model.ReadResultFields{
				ReadIntegrity: model.ReadIntegrityComplete,
			},
		})
		return
	}

	includeMemo := q.Get("include_memo") == "true"

	limit := 100
	if ls := q.Get("limit"); ls != "" {
		if n, err := strconv.Atoi(ls); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 500 {
		limit = 500
	}

	result, err := h.svc.Search(r.Context(), targetID, dbName, branchName, keyword, includeMemo, limit)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
