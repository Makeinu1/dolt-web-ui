package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func (h *Handler) SubmitRequest(w http.ResponseWriter, r *http.Request) {
	var req model.SubmitRequestRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}

	if req.TargetID == "" || req.DBName == "" || req.BranchName == "" || req.SummaryJa == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, branch_name, and summary_ja are required")
		return
	}

	if mainGuard(w, req.BranchName) {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	result, err := h.svc.SubmitRequest(ctx, req)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) ListRequests(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("target_id")
	dbName := r.URL.Query().Get("db_name")
	if targetID == "" || dbName == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id and db_name are required")
		return
	}

	requests, err := h.svc.ListRequests(r.Context(), targetID, dbName)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, requests)
}

func (h *Handler) GetRequest(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("target_id")
	dbName := r.URL.Query().Get("db_name")
	requestID := r.URL.Query().Get("request_id")
	if targetID == "" || dbName == "" || requestID == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, and request_id are required")
		return
	}

	result, err := h.svc.GetRequest(r.Context(), targetID, dbName, requestID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) ApproveRequest(w http.ResponseWriter, r *http.Request) {
	var req model.ApproveRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}

	if req.TargetID == "" || req.DBName == "" || req.RequestID == "" || req.MergeMessageJa == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, request_id, and merge_message_ja are required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	result, err := h.svc.ApproveRequest(ctx, req)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) RejectRequest(w http.ResponseWriter, r *http.Request) {
	var req model.RejectRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument, "invalid request body")
		return
	}

	if req.TargetID == "" || req.DBName == "" || req.RequestID == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"target_id, db_name, and request_id are required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	if err := h.svc.RejectRequest(ctx, req); err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "rejected"})
}
