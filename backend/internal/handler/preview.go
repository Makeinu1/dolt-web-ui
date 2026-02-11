package handler

import (
	"net/http"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func (h *Handler) PreviewClone(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}

func (h *Handler) PreviewBatchGenerate(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}

func (h *Handler) PreviewBulkUpdate(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}
