package handler

import (
	"net/http"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// GetMemoMap returns pk_value:column_name keys that have a memo for a table.
// GET /api/v1/memo/map?target_id=&db_name=&branch_name=&table=
func (h *Handler) GetMemoMap(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	targetID := q.Get("target_id")
	dbName := q.Get("db_name")
	branchName := q.Get("branch_name")
	table := q.Get("table")
	if targetID == "" || dbName == "" || branchName == "" || table == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, branch_name, and table are required")
		return
	}
	if err := validation.ValidateIdentifier("table", table); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid table name")
		return
	}

	cells, err := h.svc.GetMemoMap(r.Context(), targetID, dbName, branchName, table)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"cells": cells})
}

// GetMemo returns the memo for a specific cell.
// GET /api/v1/memo?target_id=&db_name=&branch_name=&table=&pk=&column=
func (h *Handler) GetMemo(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	targetID := q.Get("target_id")
	dbName := q.Get("db_name")
	branchName := q.Get("branch_name")
	table := q.Get("table")
	pk := q.Get("pk")
	column := q.Get("column")
	if targetID == "" || dbName == "" || branchName == "" || table == "" || pk == "" || column == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, branch_name, table, pk, and column are required")
		return
	}
	if err := validation.ValidateIdentifier("table", table); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid table name")
		return
	}
	if err := validation.ValidateIdentifier("column", column); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid column name")
		return
	}

	result, err := h.svc.GetMemo(r.Context(), targetID, dbName, branchName, table, pk, column)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
