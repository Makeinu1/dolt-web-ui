package handler

import (
	"net/http"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

// ListComments returns all comments for a specific cell (table + pk + column).
// GET /api/v1/comments?target_id=&db_name=&branch_name=&table=&pk=&column=
func (h *Handler) ListComments(w http.ResponseWriter, r *http.Request) {
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

	comments, err := h.svc.ListComments(r.Context(), targetID, dbName, branchName, table, pk, column)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, comments)
}

// GetCommentMap returns cell keys ("pk:column") that have comments for a table.
// GET /api/v1/comments/map?target_id=&db_name=&branch_name=&table=
func (h *Handler) GetCommentMap(w http.ResponseWriter, r *http.Request) {
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

	cells, err := h.svc.GetCommentMap(r.Context(), targetID, dbName, branchName, table)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"cells": cells})
}

// AddComment adds a comment to a cell.
// POST /api/v1/comments
func (h *Handler) AddComment(w http.ResponseWriter, r *http.Request) {
	var req model.AddCommentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}
	if req.TargetID == "" || req.DbName == "" || req.BranchName == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, and branch_name are required")
		return
	}
	if mainGuard(w, req.BranchName) {
		return
	}

	id, err := h.svc.AddComment(r.Context(), req)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"comment_id": id})
}

// DeleteComment deletes a comment by ID.
// POST /api/v1/comments/delete
func (h *Handler) DeleteComment(w http.ResponseWriter, r *http.Request) {
	var req model.DeleteCommentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}
	if req.TargetID == "" || req.DbName == "" || req.BranchName == "" || req.CommentID == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, branch_name, and comment_id are required")
		return
	}
	if mainGuard(w, req.BranchName) {
		return
	}

	if err := h.svc.DeleteComment(r.Context(), req); err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// SearchComments searches comments by keyword in the current branch.
// GET /api/v1/comments/search?target_id=&db_name=&branch_name=&q=
func (h *Handler) SearchComments(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	targetID := q.Get("target_id")
	dbName := q.Get("db_name")
	branchName := q.Get("branch_name")
	keyword := q.Get("q")
	if targetID == "" || dbName == "" || branchName == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, and branch_name are required")
		return
	}

	comments, err := h.svc.SearchComments(r.Context(), targetID, dbName, branchName, keyword)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, comments)
}

// ListCommentsForPks returns all comments for specific PKs (comma-separated) in a table.
// GET /api/v1/comments/for-pks?target_id=&db_name=&branch_name=&table=&pks=1,2,3
func (h *Handler) ListCommentsForPks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	targetID := q.Get("target_id")
	dbName := q.Get("db_name")
	branchName := q.Get("branch_name")
	table := q.Get("table")
	pksRaw := q.Get("pks")
	if targetID == "" || dbName == "" || branchName == "" || table == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, branch_name, and table are required")
		return
	}

	var pks []string
	if pksRaw != "" {
		for _, pk := range strings.Split(pksRaw, ",") {
			pk = strings.TrimSpace(pk)
			if pk != "" {
				pks = append(pks, pk)
			}
		}
	}

	comments, err := h.svc.ListCommentsForPks(r.Context(), targetID, dbName, branchName, table, pks)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, comments)
}
