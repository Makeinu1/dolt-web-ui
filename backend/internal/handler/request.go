package handler

import (
	"net/http"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func (h *Handler) SubmitRequest(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}

func (h *Handler) ListRequests(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}

func (h *Handler) GetRequest(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}

func (h *Handler) ApproveRequest(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}

func (h *Handler) RejectRequest(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, model.CodeInternal, "not implemented")
}
