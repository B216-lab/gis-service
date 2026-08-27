package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"geopanel/backend/internal/postgres"
)

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

func (server *Server) handleRegisterLayerTileSource(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.LayerTileSourceRequest

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
			"invalid_layer_tile_source_request",
			err.Error(),
		)
		return
	}

	server.pruneExpiredTileSources(time.Now())

	token, err := generateTileSourceToken()
	if err != nil {
		handleServiceError(
			writer,
			err,
			"layer_tile_source_failed",
			"Unexpected server error.",
		)
		return
	}

	server.tileSourcesMux.Lock()
	server.tileSources[token] = tileSourceEntry{
		request:   payload,
		createdAt: time.Now(),
	}
	server.tileSourcesMux.Unlock()

	writeJSON(writer, http.StatusOK, layerTileSourceResult{
		Token:       token,
		Tiles:       []string{"/api/v1/vector-tiles/" + token + "/{z}/{x}/{y}"},
		SourceLayer: postgres.LayerVectorTileName,
	})
}

func (server *Server) handleLayerVectorTile(
	writer http.ResponseWriter,
	request *http.Request,
) {
	z, err := strconv.Atoi(request.PathValue("z"))
	if err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_tile", "Invalid tile zoom.")
		return
	}

	x, err := strconv.Atoi(request.PathValue("x"))
	if err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_tile", "Invalid tile x.")
		return
	}

	y, err := strconv.Atoi(request.PathValue("y"))
	if err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_tile", "Invalid tile y.")
		return
	}

	token := request.PathValue("token")
	server.tileSourcesMux.RLock()
	entry, ok := server.tileSources[token]
	server.tileSourcesMux.RUnlock()
	if !ok {
		writeError(
			writer,
			http.StatusNotFound,
			"tile_source_not_found",
			"Tile source not found.",
		)
		return
	}
	if time.Since(entry.createdAt) > tileSourceTTL {
		server.tileSourcesMux.Lock()
		delete(server.tileSources, token)
		server.tileSourcesMux.Unlock()
		writeError(
			writer,
			http.StatusNotFound,
			"tile_source_expired",
			"Tile source expired.",
		)
		return
	}
	server.tileSourcesMux.Lock()
	if currentEntry, ok := server.tileSources[token]; ok {
		currentEntry.createdAt = time.Now()
		server.tileSources[token] = currentEntry
	}
	server.tileSourcesMux.Unlock()

	tile, err := server.service.GetLayerVectorTile(
		request.Context(),
		postgres.LayerVectorTileRequest{
			LayerTileSourceRequest: entry.request,
			Z:                      z,
			X:                      x,
			Y:                      y,
		},
	)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"database_vector_tile_failed",
			"Unexpected server error.",
		)
		return
	}

	writer.Header().Set("Content-Type", "application/vnd.mapbox-vector-tile")
	writer.Header().Set("Cache-Control", "private, max-age=3600")
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(tile)
}

func (server *Server) handleLayerExtent(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.LayerExtentRequest

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
			"invalid_layer_extent_request",
			err.Error(),
		)
		return
	}

	result, err := server.service.GetLayerExtent(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"database_layer_extent_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) handleCommitTableChanges(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.CommitTableChangesRequest

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
			"invalid_table_commit_request",
			err.Error(),
		)
		return
	}

	result, err := server.service.CommitTableChanges(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"database_table_commit_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) handleCreateFeature(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.CreateFeatureRequest

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
			"invalid_feature_create_request",
			err.Error(),
		)
		return
	}

	result, err := server.service.CreateFeature(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"database_feature_create_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func (server *Server) handleFlowmapData(
	writer http.ResponseWriter,
	request *http.Request,
) {
	var payload postgres.ListFlowmapDataRequest

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
			"invalid_flowmap_request",
			err.Error(),
		)
		return
	}

	result, err := server.service.ListFlowmapData(request.Context(), payload)
	if err != nil {
		handleServiceError(
			writer,
			err,
			"database_flowmap_fetch_failed",
			"Unexpected server error.",
		)
		return
	}

	writeJSON(writer, http.StatusOK, result)
}
