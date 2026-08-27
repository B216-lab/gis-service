package httpapi

import (
	"encoding/json"
	"net/http"

	"geopanel/backend/internal/postgres"
)

func (server *Server) handleListRegisteredConnections(
	writer http.ResponseWriter,
	_ *http.Request,
) {
	writeJSON(writer, http.StatusOK, server.service.ListRegisteredConnections())
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
