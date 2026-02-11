package handler

import (
	"net/http"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func (h *Handler) ListTargets(w http.ResponseWriter, r *http.Request) {
	targets := h.svc.ListTargets()
	writeJSON(w, http.StatusOK, targets)
}

func (h *Handler) ListDatabases(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("target_id")
	if targetID == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id is required")
		return
	}

	dbs, err := h.svc.ListDatabases(targetID)
	if err != nil {
		writeError(w, http.StatusNotFound, model.CodeNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, dbs)
}

func (h *Handler) ListBranches(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("target_id")
	dbName := r.URL.Query().Get("db_name")
	if targetID == "" || dbName == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id and db_name are required")
		return
	}

	branches, err := h.svc.ListBranches(r.Context(), targetID, dbName)
	if err != nil {
		writeError(w, http.StatusInternalServerError, model.CodeInternal, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, branches)
}

func (h *Handler) CreateBranch(w http.ResponseWriter, r *http.Request) {
	var req model.CreateBranchRequest
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

	if err := h.svc.CreateBranch(r.Context(), req); err != nil {
		writeError(w, http.StatusInternalServerError, model.CodeInternal, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"branch_name": req.BranchName})
}

func (h *Handler) GetHead(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("target_id")
	dbName := r.URL.Query().Get("db_name")
	branchName := r.URL.Query().Get("branch_name")
	if targetID == "" || dbName == "" || branchName == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id, db_name, and branch_name are required")
		return
	}

	head, err := h.svc.GetHead(r.Context(), targetID, dbName, branchName)
	if err != nil {
		writeError(w, http.StatusInternalServerError, model.CodeInternal, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, head)
}
