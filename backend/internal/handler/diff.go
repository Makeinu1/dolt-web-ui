package handler

import (
	"net/http"
	"strconv"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func (h *Handler) DiffTable(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("target_id")
	dbName := r.URL.Query().Get("db_name")
	branchName := r.URL.Query().Get("branch_name")
	table := r.URL.Query().Get("table")
	fromRef := r.URL.Query().Get("from_ref")
	toRef := r.URL.Query().Get("to_ref")
	if targetID == "" || dbName == "" || branchName == "" || table == "" || fromRef == "" || toRef == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, branch_name, table, from_ref, and to_ref are required")
		return
	}

	mode := r.URL.Query().Get("mode") // "two_dot" or "three_dot"
	skinny := r.URL.Query().Get("skinny") == "true"

	rows, err := h.svc.DiffTable(r.Context(), targetID, dbName, branchName, table, fromRef, toRef, mode, skinny)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, model.DiffResponse{Rows: rows})
}

func (h *Handler) HistoryCommits(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("target_id")
	dbName := r.URL.Query().Get("db_name")
	branchName := r.URL.Query().Get("branch_name")
	if targetID == "" || dbName == "" || branchName == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, and branch_name are required")
		return
	}

	page := 1
	if p := r.URL.Query().Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			page = v
		}
	}
	pageSize := 20
	if ps := r.URL.Query().Get("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil && v > 0 && v <= 100 {
			pageSize = v
		}
	}

	commits, err := h.svc.HistoryCommits(r.Context(), targetID, dbName, branchName, page, pageSize)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, commits)
}

func (h *Handler) HistoryRow(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("target_id")
	dbName := r.URL.Query().Get("db_name")
	branchName := r.URL.Query().Get("branch_name")
	table := r.URL.Query().Get("table")
	pk := r.URL.Query().Get("pk")
	if targetID == "" || dbName == "" || branchName == "" || table == "" || pk == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, branch_name, table, and pk are required")
		return
	}

	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 100 {
			limit = v
		}
	}

	history, err := h.svc.HistoryRow(r.Context(), targetID, dbName, branchName, table, pk, limit)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, history)
}
