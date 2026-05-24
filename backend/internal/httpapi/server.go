package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"geopanel/backend/internal/postgres"
)

type Server struct {
	service *postgres.Service
	mux     *http.ServeMux
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errorResponse struct {
	Error apiError `json:"error"`
}

func NewServer(service *postgres.Service) *http.ServeMux {
	server := &Server{
		service: service,
		mux:     http.NewServeMux(),
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
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/tables",
		server.handleListTables,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/rows",
		server.handleListRows,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/layer-features",
		server.handleListLayerFeatures,
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

	result, err := server.service.TestConnection(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"database_connection_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) handleListTables(
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

	result, err := server.service.ListTables(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"database_table_list_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) handleListRows(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.ListRowsRequest

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
	payload.Normalize()

	if err := payload.Validate(); err != nil {
		writeError(
			writer,
			http.StatusUnprocessableEntity,
			"invalid_row_request",
			err.Error(),
		)
		return
	}

	result, err := server.service.ListRows(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"database_row_fetch_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) handleListLayerFeatures(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.ListLayerFeaturesRequest

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
	payload.Normalize()

	if err := payload.Validate(); err != nil {
		writeError(
			writer,
			http.StatusUnprocessableEntity,
			"invalid_layer_request",
			err.Error(),
		)
		return
	}

	result, err := server.service.ListLayerFeatures(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"database_layer_fetch_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func handleServiceError(
	writer http.ResponseWriter,
	err error,
	serviceErrorCode string,
	fallbackMessage string,
) {
	if errors.Is(err, postgres.ErrConnectionFailed) {
		writeError(
			writer,
			http.StatusServiceUnavailable,
			serviceErrorCode,
			err.Error(),
		)
		return
	}

	writeError(
		writer,
		http.StatusInternalServerError,
		"internal_error",
		fallbackMessage,
	)
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
