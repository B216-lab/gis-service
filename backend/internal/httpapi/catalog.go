package httpapi

import (
	"encoding/json"
	"net/http"

	"geopanel/backend/internal/postgres"
)

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

func (server *Server) handleListSchemas(
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

	result, err := server.service.ListSchemas(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"database_schema_list_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) handleListSchemaTables(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.SchemaTablesRequest

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
			"invalid_schema_table_payload",
			err.Error(),
		)
		return
	}

	result, err := server.service.ListSchemaTables(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"database_schema_table_list_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) handleSaveSchemaDisplayConfigs(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.SaveSchemaDisplayConfigsRequest

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
			"invalid_schema_display_configs_payload",
			err.Error(),
		)
		return
	}

	configs, err := server.service.SaveSchemaDisplayConfigs(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"schema_display_configs_save_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{"configs": configs})
}

func (server *Server) handleTableMetadata(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.TableMetadataRequest

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
			"invalid_table_metadata_payload",
			err.Error(),
		)
		return
	}

	result, err := server.service.GetTableMetadata(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"database_table_metadata_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) handleListTableDisplayConfigs(
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

	result, err := server.service.ListTableDisplayConfigs(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"table_display_config_list_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) handleSaveTableDisplayConfig(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.SaveTableDisplayConfigRequest

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
			"invalid_table_display_config_payload",
			err.Error(),
		)
		return
	}

	result, err := server.service.SaveTableDisplayConfig(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"table_display_config_save_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}
