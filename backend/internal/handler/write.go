package handler

import (
	"net/http"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func (h *Handler) Commit(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}

func (h *Handler) Sync(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}
