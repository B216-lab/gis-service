package httpapi

import (
	"encoding/json"
	"net/http"

	"geopanel/backend/internal/postgres"
)

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

func (server *Server) handleLookupRows(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.LookupRowsRequest

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
			"invalid_row_lookup_request",
			err.Error(),
		)
		return
	}

	result, err := server.service.LookupRows(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"database_row_lookup_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) handleRelatedRows(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.RelatedRowsRequest

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
			"invalid_related_rows_request",
			err.Error(),
		)
		return
	}

	result, err := server.service.ListRelatedRows(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"database_related_rows_fetch_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) handleRelationLabels(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.RelationLabelsRequest

	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_json", "Request body must be valid JSON.")
		return
	}

	payload.TrimSpaces()
	payload.Normalize()
	if err := payload.Validate(); err != nil {
		writeError(writer, http.StatusUnprocessableEntity, "invalid_relation_labels_request", err.Error())
		return
	}

	result, err := server.service.ListRelationLabels(request.Context(), payload)
	if err != nil {
		handleServiceError(writer, err, "database_relation_labels_failed", "Unexpected server error.")
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) handleRelationOptions(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.RelationOptionsRequest

	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_json", "Request body must be valid JSON.")
		return
	}

	payload.TrimSpaces()
	payload.Normalize()
	if err := payload.Validate(); err != nil {
		writeError(writer, http.StatusUnprocessableEntity, "invalid_relation_options_request", err.Error())
		return
	}

	result, err := server.service.ListRelationOptions(request.Context(), payload)
	if err != nil {
		handleServiceError(writer, err, "database_relation_options_failed", "Unexpected server error.")
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) handleLocateFeature(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.LocateFeatureRequest

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
			"invalid_feature_locate_request",
			err.Error(),
		)
		return
	}

	result, err := server.service.LocateFeature(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"database_feature_locate_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}
