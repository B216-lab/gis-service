package analytics

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
)

type Handler struct {
	Mux   *http.ServeMux
	Store *Store
}

func NewHandler(store *Store) *Handler {
	h := &Handler{Mux: http.NewServeMux(), Store: store}
	for _, kind := range []string{"datasets", "charts", "dashboards"} {
		base := "/api/v1/analytics/" + kind
		h.Mux.HandleFunc("GET "+base, noStore(func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, 200, map[string]any{"items": store.List(kind)})
		}))
		h.Mux.HandleFunc("GET "+base+"/{id}", noStore(func(w http.ResponseWriter, r *http.Request) {
			v, e := store.Get(kind, r.PathValue("id"))
			if e != nil {
				writeError(w, e)
				return
			}
			writeJSON(w, 200, v)
		}))
		for _, method := range []string{"POST", "PUT"} {
			path := base
			if method == "PUT" {
				path += "/{id}"
			}
			h.Mux.HandleFunc(method+" "+path, noStore(func(w http.ResponseWriter, r *http.Request) {
				r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
				raw, e := io.ReadAll(r.Body)
				if e != nil {
					writeError(w, ErrInvalid)
					return
				}
				raw, e = canonical(kind, raw)
				if e != nil {
					writeError(w, e)
					return
				}
				var m Metadata
				_ = json.Unmarshal(raw, &m)
				if r.Method == "PUT" && r.PathValue("id") != m.ID {
					writeError(w, ErrInvalid)
					return
				}
				v, e := store.Save(kind, raw, r.Method == "POST")
				if e != nil {
					writeError(w, e)
					return
				}
				status := 200
				if r.Method == "POST" {
					status = 201
				}
				writeJSON(w, status, v)
			}))
		}
		h.Mux.HandleFunc("DELETE "+base+"/{id}", noStore(func(w http.ResponseWriter, r *http.Request) {
			revision, e := strconv.Atoi(r.URL.Query().Get("revision"))
			if e != nil || revision < 1 {
				writeError(w, ErrInvalid)
				return
			}
			if e = store.Delete(kind, r.PathValue("id"), revision); e != nil {
				writeError(w, e)
				return
			}
			w.WriteHeader(204)
		}))
	}
	return h
}
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) { h.Mux.ServeHTTP(w, r) }

// Access is enforced by the deployment's upstream authentication proxy.
func noStore(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { w.Header().Set("Cache-Control", "no-store"); next(w, r) }
}
func canonical(kind string, raw []byte) (json.RawMessage, error) {
	var value any
	switch kind {
	case "datasets":
		value = &Dataset{}
	case "charts":
		value = &Chart{}
	case "dashboards":
		value = &Dashboard{}
	default:
		return nil, ErrInvalid
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if dec.Decode(value) != nil {
		return nil, ErrInvalid
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		return nil, ErrInvalid
	}
	return json.Marshal(value)
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, err error) {
	status, code, message := 500, "storage_error", "Analytics storage unavailable."
	switch {
	case errors.Is(err, ErrNotFound):
		status, code, message = 404, "not_found", err.Error()
	case errors.Is(err, ErrConflict):
		status, code, message = 409, "revision_conflict", err.Error()
	case errors.Is(err, ErrInvalid):
		status, code, message = 400, "invalid_definition", err.Error()
	}
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
