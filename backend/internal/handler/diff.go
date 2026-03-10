package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func (h *Handler) DiffTable(w http.ResponseWriter, r *http.Request) {
	targetID, dbName, branchName, ok := parseQueryContext(w, r)
	if !ok {
		return
	}
	table := r.URL.Query().Get("table")
	fromRef := r.URL.Query().Get("from_ref")
	toRef := r.URL.Query().Get("to_ref")
	if table == "" || fromRef == "" || toRef == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"table, from_ref, and to_ref are required")
		return
	}

	mode := r.URL.Query().Get("mode") // "two_dot" or "three_dot"
	skinny := r.URL.Query().Get("skinny") == "true"
	diffType := r.URL.Query().Get("diff_type") // "added", "modified", "removed", or ""

	page := 1
	if p := r.URL.Query().Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			page = v
		}
	}
	pageSize := 50
	if ps := r.URL.Query().Get("page_size"); ps != "" {
		if v, err := strconv.Atoi(ps); err == nil && v > 0 && v <= 200 {
			pageSize = v
		}
	}

	resp, err := h.svc.DiffTable(r.Context(), targetID, dbName, branchName, table, fromRef, toRef, mode, skinny, diffType, page, pageSize)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) DiffSummary(w http.ResponseWriter, r *http.Request) {
	targetID, dbName, branchName, ok := parseQueryContext(w, r)
	if !ok {
		return
	}

	fromRef := r.URL.Query().Get("from_ref")
	if fromRef == "" {
		fromRef = "main"
	}
	toRef := r.URL.Query().Get("to_ref")
	if toRef == "" {
		toRef = branchName
	}
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "three_dot"
	}

	entries, err := h.svc.DiffSummary(r.Context(), targetID, dbName, branchName, fromRef, toRef, mode)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, model.DiffSummaryResponse{Entries: entries})
}

func (h *Handler) ExportDiffZip(w http.ResponseWriter, r *http.Request) {
	targetID, dbName, branchName, ok := parseQueryContext(w, r)
	if !ok {
		return
	}
	fromRef := r.URL.Query().Get("from_ref")
	toRef := r.URL.Query().Get("to_ref")
	if fromRef == "" || toRef == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"from_ref and to_ref are required")
		return
	}

	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "three_dot"
	}

	data, zipName, warning, err := h.svc.ExportDiffZip(r.Context(), targetID, dbName, branchName, fromRef, toRef, mode)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	// NEW-6: sanitize zipName to prevent Content-Disposition header injection.
	safeZipName := strings.Map(func(r rune) rune {
		if r == '"' || r == '\r' || r == '\n' || r < 0x20 {
			return -1
		}
		return r
	}, zipName)
	w.Header().Set("Content-Disposition", `attachment; filename="`+safeZipName+`"`)
	if warning != "" {
		w.Header().Set("X-Diff-Warning", warning)
	}
	w.WriteHeader(http.StatusOK)
	w.Write(data) //nolint:errcheck
}

func (h *Handler) HistoryRow(w http.ResponseWriter, r *http.Request) {
	targetID, dbName, branchName, ok := parseQueryContext(w, r)
	if !ok {
		return
	}
	table := r.URL.Query().Get("table")
	pk := r.URL.Query().Get("pk")
	if table == "" || pk == "" {
		writeError(w, http.StatusBadRequest, model.CodeInvalidArgument,
			"table and pk are required")
		return
	}

	limit := 30
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 200 {
			limit = v
		}
	}

	resp, err := h.svc.HistoryRow(r.Context(), targetID, dbName, branchName, table, pk, limit)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) HistoryCommits(w http.ResponseWriter, r *http.Request) {
	targetID, dbName, branchName, ok := parseQueryContext(w, r)
	if !ok {
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

	keyword := r.URL.Query().Get("keyword")          // substring match on message
	fromDate := r.URL.Query().Get("from_date")       // YYYY-MM-DD
	toDate := r.URL.Query().Get("to_date")           // YYYY-MM-DD
	searchField := r.URL.Query().Get("search_field") // "message" (default) | "branch"
	filterTable := r.URL.Query().Get("filter_table") // table name for record-level filter
	filterPk := r.URL.Query().Get("filter_pk")       // JSON-encoded PK for record-level filter

	commits, err := h.svc.HistoryCommits(r.Context(), targetID, dbName, branchName, page, pageSize, keyword, fromDate, toDate, searchField, filterTable, filterPk)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, commits)
}
