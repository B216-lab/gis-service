package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"geopanel/backend/internal/postgres"
)

type Server struct {
	tester *postgres.ConnectionTester
	mux    *http.ServeMux
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errorResponse struct {
	Error apiError `json:"error"`
}

func NewServer(tester *postgres.ConnectionTester) *http.ServeMux {
	server := &Server{
		tester: tester,
		mux:    http.NewServeMux(),
	}

	server.routes()

	return server.mux
}

func (server *Server) routes() {
	server.mux.HandleFunc("GET /api/v1/health", server.handleHealth)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/test",
		server.handleConnectionTest,
	)
}

func (server *Server) handleHealth(
	writer http.ResponseWriter,
	_ *http.Request,
) {
	writeJSON(
		writer,
		http.StatusOK,
		map[string]string{
			"status": "ok",
		},
	)
}

func (server *Server) handleConnectionTest(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.ConnectionTestRequest

	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeError(
			writer,
			http.StatusBadRequest,
			"invalid_json",
			"Request body must be valid JSON.",
		)
		return
	}

	payload.TrimSpaces()

	if err := payload.Validate(); err != nil {
		writeError(
			writer,
			http.StatusUnprocessableEntity,
			"invalid_connection_payload",
			err.Error(),
		)
		return
	}

	result, err := server.tester.TestConnection(request.Context(), payload)
	if err != nil {
		if errors.Is(err, postgres.ErrConnectionFailed) {
			writeError(
				writer,
				http.StatusServiceUnavailable,
				"database_connection_failed",
				err.Error(),
			)
			return
		}

		writeError(
			writer,
			http.StatusInternalServerError,
			"internal_error",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func writeError(
	writer http.ResponseWriter,
	statusCode int,
	code string,
	message string,
) {
	writeJSON(
		writer,
		statusCode,
		errorResponse{
			Error: apiError{
				Code:    code,
				Message: message,
			},
		},
	)
}

func writeJSON(
	writer http.ResponseWriter,
	statusCode int,
	payload any,
) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(statusCode)

	if err := json.NewEncoder(writer).Encode(payload); err != nil {
		http.Error(writer, err.Error(), http.StatusInternalServerError)
	}
}
