package handler

import (
	"net/http"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func (h *Handler) DiffTable(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}

func (h *Handler) HistoryCommits(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}

func (h *Handler) HistoryRow(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}
