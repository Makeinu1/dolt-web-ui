package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func (h *Handler) ListTables(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("target_id")
	dbName := r.URL.Query().Get("db_name")
	branchName := r.URL.Query().Get("branch_name")
	if targetID == "" || dbName == "" || branchName == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id, db_name, and branch_name are required")
		return
	}

	tables, err := h.svc.ListTables(r.Context(), targetID, dbName, branchName)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tables)
}

func (h *Handler) GetTableSchema(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("target_id")
	dbName := r.URL.Query().Get("db_name")
	branchName := r.URL.Query().Get("branch_name")
	table := r.URL.Query().Get("table")
	if targetID == "" || dbName == "" || branchName == "" || table == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id, db_name, branch_name, and table are required")
		return
	}

	schema, err := h.svc.GetTableSchema(r.Context(), targetID, dbName, branchName, table)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, schema)
}

func (h *Handler) GetTableRows(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("target_id")
	dbName := r.URL.Query().Get("db_name")
	branchName := r.URL.Query().Get("branch_name")
	table := r.URL.Query().Get("table")
	if targetID == "" || dbName == "" || branchName == "" || table == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id, db_name, branch_name, and table are required")
		return
	}

	page := 1
	if p := r.URL.Query().Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			page = v
		}
	}
	pageSize := 50
	if ps := r.URL.Query().Get("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil && v > 0 && v <= 500 {
			pageSize = v
		}
	}

	filter := r.URL.Query().Get("filter")
	sort := r.URL.Query().Get("sort")

	result, err := h.svc.GetTableRows(r.Context(), targetID, dbName, branchName, table, page, pageSize, filter, sort)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) GetTableRow(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("target_id")
	dbName := r.URL.Query().Get("db_name")
	branchName := r.URL.Query().Get("branch_name")
	table := r.URL.Query().Get("table")
	pk := r.URL.Query().Get("pk")
	if targetID == "" || dbName == "" || branchName == "" || table == "" || pk == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id, db_name, branch_name, table, and pk are required")
		return
	}

	row, err := h.svc.GetTableRow(r.Context(), targetID, dbName, branchName, table, pk)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// handleServiceError maps service-layer errors to HTTP responses.
func handleServiceError(w http.ResponseWriter, err error) {
	var apiErr *model.APIError
	if errors.As(err, &apiErr) {
		if apiErr.Details != nil {
			writeErrorWithDetails(w, apiErr.Status, apiErr.Code, apiErr.Msg, apiErr.Details)
		} else {
			writeError(w, apiErr.Status, apiErr.Code, apiErr.Msg)
		}
		return
	}
	writeError(w, http.StatusInternalServerError, model.CodeInternal, err.Error())
}
