package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func (h *Handler) CrossCopyPreview(w http.ResponseWriter, r *http.Request) {
	var req model.CrossCopyPreviewRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}

	if req.TargetID == "" || req.SourceDB == "" || req.SourceBranch == "" || req.SourceTable == "" || req.DestDB == "" || req.DestBranch == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id, source_db, source_branch, source_table, dest_db, and dest_branch are required")
		return
	}

	result, err := h.svc.CrossCopyPreview(r.Context(), req)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) CrossCopyRows(w http.ResponseWriter, r *http.Request) {
	var req model.CrossCopyRowsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}

	if req.TargetID == "" || req.SourceDB == "" || req.SourceBranch == "" || req.SourceTable == "" || req.DestDB == "" || req.DestBranch == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id, source_db, source_branch, source_table, dest_db, and dest_branch are required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	result, err := h.svc.CrossCopyRows(ctx, req)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) CrossCopyAdminPrepareRows(w http.ResponseWriter, r *http.Request) {
	var req model.CrossCopyAdminPrepareRowsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}

	if req.TargetID == "" || req.SourceDB == "" || req.SourceBranch == "" || req.SourceTable == "" || req.DestDB == "" || req.DestBranch == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id, source_db, source_branch, source_table, dest_db, and dest_branch are required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	result, err := h.svc.CrossCopyAdminPrepareRows(ctx, req)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) CrossCopyTable(w http.ResponseWriter, r *http.Request) {
	var req model.CrossCopyTableRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}

	if req.TargetID == "" || req.SourceDB == "" || req.SourceBranch == "" || req.SourceTable == "" || req.DestDB == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id, source_db, source_branch, source_table, and dest_db are required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	result, err := h.svc.CrossCopyTable(ctx, req)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) CrossCopyAdminPrepareTable(w http.ResponseWriter, r *http.Request) {
	var req model.CrossCopyAdminPrepareTableRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}

	if req.TargetID == "" || req.SourceDB == "" || req.SourceBranch == "" || req.SourceTable == "" || req.DestDB == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id, source_db, source_branch, source_table, and dest_db are required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	result, err := h.svc.CrossCopyAdminPrepareTable(ctx, req)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) CrossCopyAdminCleanupImport(w http.ResponseWriter, r *http.Request) {
	var req model.CrossCopyAdminCleanupImportRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}

	if req.TargetID == "" || req.DestDB == "" || req.BranchName == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "target_id, dest_db, and branch_name are required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	result, err := h.svc.CrossCopyAdminCleanupImport(ctx, req)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
