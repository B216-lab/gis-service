package httpapi

import (
	"net/http"
	"sync"
	"time"

	"geopanel/backend/internal/postgres"
)

type Server struct {
	service        *postgres.Service
	mux            *http.ServeMux
	tileSources    map[string]tileSourceEntry
	tileSourcesMux sync.RWMutex
}

type tileSourceEntry struct {
	request   postgres.LayerTileSourceRequest
	createdAt time.Time
}

type layerTileSourceResult struct {
	Token       string   `json:"token"`
	Tiles       []string `json:"tiles"`
	SourceLayer string   `json:"sourceLayer"`
}

const tileSourceTTL = 12 * time.Hour

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errorResponse struct {
	Error apiError `json:"error"`
}

func NewServer(service *postgres.Service) *http.ServeMux {
	server := &Server{
		service:     service,
		mux:         http.NewServeMux(),
		tileSources: make(map[string]tileSourceEntry),
	}

	server.routes()

	return server.mux
}

func (server *Server) routes() {
	server.mux.HandleFunc("GET /api/v1/health", server.handleHealth)
	server.mux.HandleFunc(
		"GET /api/v1/database-connections",
		server.handleListRegisteredConnections,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/test",
		server.handleConnectionTest,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/tables",
		server.handleListTables,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/schemas",
		server.handleListSchemas,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/schemas/tables",
		server.handleListSchemaTables,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/schema-display-configs/save",
		server.handleSaveSchemaDisplayConfigs,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/tables/metadata",
		server.handleTableMetadata,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/table-display-configs",
		server.handleListTableDisplayConfigs,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/table-display-configs/save",
		server.handleSaveTableDisplayConfig,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/rows",
		server.handleListRows,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/rows/lookup",
		server.handleLookupRows,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/rows/related",
		server.handleRelatedRows,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/relation-labels",
		server.handleRelationLabels,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/relation-options",
		server.handleRelationOptions,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/features/locate",
		server.handleLocateFeature,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/rows/commit",
		server.handleCommitTableChanges,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/features",
		server.handleCreateFeature,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/layer-extent",
		server.handleLayerExtent,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/layer-features",
		server.handleListLayerFeatures,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/layer-tile-source",
		server.handleRegisterLayerTileSource,
	)
	server.mux.HandleFunc(
		"GET /api/v1/vector-tiles/{token}/{z}/{x}/{y}",
		server.handleLayerVectorTile,
	)
	server.mux.HandleFunc(
		"POST /api/v1/database-connections/flowmap-data",
		server.handleFlowmapData,
	)
}
