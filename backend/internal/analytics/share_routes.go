package analytics

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
)

func decodePublicationRequest(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 128<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return ErrInvalid
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return ErrInvalid
	}
	return nil
}
func RegisterPublicationRoutes(h *Handler, queries *QueryService) {
	h.Mux.HandleFunc("GET /api/v1/analytics/dashboards/{id}/publications", noStore(func(w http.ResponseWriter, r *http.Request) {
		items := []Metadata{}
		for _, raw := range h.Store.List("publications") {
			var p Publication
			if json.Unmarshal(raw, &p) == nil && p.Dashboard.ID == r.PathValue("id") {
				items = append(items, p.Metadata)
			}
		}
		writeJSON(w, 200, map[string]any{"items": items})
	}))
	h.Mux.HandleFunc("POST /api/v1/analytics/dashboards/{id}/publish", noStore(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Revision int `json:"revision"`
		}
		if e := decodePublicationRequest(w, r, &req); e != nil {
			writeError(w, e)
			return
		}
		p, e := h.Store.Publish(r.PathValue("id"), req.Revision)
		if e != nil {
			writeError(w, e)
			return
		}
		writeJSON(w, 201, p.Viewer())
	}))
	h.Mux.HandleFunc("GET /api/v1/analytics/publications/{id}", noStore(func(w http.ResponseWriter, r *http.Request) {
		p, e := h.Store.Publication(r.PathValue("id"))
		if e != nil {
			writeError(w, e)
			return
		}
		writeJSON(w, 200, p.Viewer())
	}))
	h.Mux.HandleFunc("POST /api/v1/analytics/publications/{id}/shares", noStore(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ExpiresAt string   `json:"expiresAt"`
			Filters   []Filter `json:"filters"`
		}
		if e := decodePublicationRequest(w, r, &req); e != nil {
			writeError(w, e)
			return
		}
		share, token, e := h.Store.CreateShare(r.PathValue("id"), req.ExpiresAt, req.Filters)
		if e != nil {
			writeError(w, e)
			return
		}
		writeJSON(w, 201, map[string]any{"share": share, "token": token})
	}))
	h.Mux.HandleFunc("GET /api/v1/analytics/publications/{id}/shares", noStore(func(w http.ResponseWriter, r *http.Request) {
		if _, e := h.Store.Publication(r.PathValue("id")); e != nil {
			writeError(w, e)
			return
		}
		items := []Share{}
		for _, raw := range h.Store.List("shares") {
			var s storedShare
			if json.Unmarshal(raw, &s) == nil && s.PublicationID == r.PathValue("id") {
				items = append(items, s.Share)
			}
		}
		writeJSON(w, 200, map[string]any{"items": items})
	}))
	h.Mux.HandleFunc("DELETE /api/v1/analytics/shares/{id}", noStore(func(w http.ResponseWriter, r *http.Request) {
		revision, e := strconv.Atoi(r.URL.Query().Get("revision"))
		if e != nil || revision < 1 {
			writeError(w, ErrInvalid)
			return
		}
		if e = h.Store.RevokeShare(r.PathValue("id"), revision); e != nil {
			writeError(w, e)
			return
		}
		w.WriteHeader(204)
	}))
	execute := func(w http.ResponseWriter, r *http.Request, p Publication, locked []Filter, scope string) {
		var req struct {
			ChartID  string   `json:"chartId"`
			WidgetID string   `json:"widgetId"`
			Filters  []Filter `json:"filters"`
		}
		if e := decodePublicationRequest(w, r, &req); e != nil {
			writeError(w, e)
			return
		}
		q, e := p.query(req.ChartID, req.WidgetID, locked, req.Filters)
		if e != nil {
			writeError(w, e)
			return
		}
		result, e := queries.ExecuteScopedFresh(r.Context(), q, p.Dataset, scope, requestNoCache(r))
		if e != nil {
			writeError(w, ErrInvalid)
			return
		}
		writeJSON(w, 200, result)
	}
	h.Mux.HandleFunc("POST /api/v1/analytics/publications/{id}/query", noStore(func(w http.ResponseWriter, r *http.Request) {
		p, e := h.Store.Publication(r.PathValue("id"))
		if e != nil {
			writeError(w, e)
			return
		}
		execute(w, r, p, nil, "publication:"+p.ID+":editor")
	}))
	public := func(next func(http.ResponseWriter, *http.Request, Publication, Share)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Set("X-Robots-Tag", "noindex, nofollow")
			share, p, e := h.Store.ResolveShare(r.PathValue("token"))
			if e != nil {
				writeError(w, ErrNotFound)
				return
			}
			next(w, r, p, share)
		}
	}
	h.Mux.HandleFunc("GET /api/v1/analytics/public/{token}", public(func(w http.ResponseWriter, r *http.Request, p Publication, s Share) {
		view := p.Viewer()
		view["filters"] = s.Filters
		writeJSON(w, 200, view)
	}))
	h.Mux.HandleFunc("POST /api/v1/analytics/public/{token}/query", public(func(w http.ResponseWriter, r *http.Request, p Publication, s Share) {
		execute(w, r, p, s.Filters, "publication:"+p.ID+":share:"+s.ID)
	}))
}
