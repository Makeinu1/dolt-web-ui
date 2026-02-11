package handler

import (
	"net/http"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func (h *Handler) ListTables(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}

func (h *Handler) GetTableSchema(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}

func (h *Handler) GetTableRows(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}

func (h *Handler) GetTableRow(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}
