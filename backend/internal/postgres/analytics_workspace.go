package postgres

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// CompileAnalyticsWorkspaceScope builds a read-only physical-table relation for
// workspace analytics. The only caller-controlled SQL-like value is a saved
// WHERE fragment, which passes the same validation used by map/table requests.
func (service *Service) CompileAnalyticsWorkspaceScope(
	ctx context.Context,
	source AnalyticsWorkspaceSource,
) (AnalyticsWorkspaceScope, error) {
	source.TrimSpaces()
	if err := source.Validate(); err != nil {
		return AnalyticsWorkspaceScope{}, err
	}
	if _, ok := service.registeredConnections[source.ConnectionID]; !ok {
		return AnalyticsWorkspaceScope{}, fmt.Errorf("%w: registered connection not found", ErrConnectionFailed)
	}

	timeout := service.timeout
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	conn, err := service.connect(timeoutCtx, ConnectionTestRequest{ID: source.ConnectionID})
	if err != nil {
		return AnalyticsWorkspaceScope{}, err
	}
	defer conn.Close(context.Background())

	definitions, err := service.listColumnDefinitions(timeoutCtx, conn, source.Schema, source.Table)
	if err != nil {
		return AnalyticsWorkspaceScope{}, err
	}
	if source.FlowColumns != nil {
		if err := validateColumnNames(definitions, workspaceFlowmapColumnNames(*source.FlowColumns)); err != nil {
			return AnalyticsWorkspaceScope{}, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
		}
	}

	filterClause, args, err := buildQueryFilterClause(definitions, source.Filter, 0)
	if err != nil {
		return AnalyticsWorkspaceScope{}, err
	}
	where := make([]string, 0, 2)
	if filterClause != "" {
		where = append(where, "("+filterClause+")")
	}
	with := ""
	if source.SpatialFilter != nil {
		spatialClause, err := service.workspaceSpatialClause(timeoutCtx, conn, source, len(args))
		if err != nil {
			return AnalyticsWorkspaceScope{}, err
		}
		with = "WITH " + spatialClause.CTE + "\n"
		where = append(where, "("+spatialClause.Clause+")")
		args = append(args, spatialClause.Parameters...)
	}
	if len(where) == 0 {
		where = append(where, "TRUE")
	}

	return AnalyticsWorkspaceScope{
		SQL: fmt.Sprintf(
			"%sSELECT source_row.* FROM %s.%s AS source_row WHERE %s",
			with,
			quoteIdentifier(source.Schema),
			quoteIdentifier(source.Table),
			strings.Join(where, " AND "),
		),
		Args: args,
	}, nil
}

func workspaceFlowmapColumnNames(columns AnalyticsWorkspaceFlowColumns) []string {
	return append(
		flowmapRequiredPointColumns(columns.StartMode, columns.StartLonColumn, columns.StartLatColumn, columns.StartGeometryColumn),
		flowmapRequiredPointColumns(columns.EndMode, columns.EndLonColumn, columns.EndLatColumn, columns.EndGeometryColumn)...,
	)
}

func (service *Service) workspaceSpatialClause(
	ctx context.Context,
	runner queryRunner,
	source AnalyticsWorkspaceSource,
	startParameterIndex int,
) (*spatialFilterClause, error) {
	if source.FlowColumns != nil {
		columns := source.FlowColumns
		startLon, startLat := flowmapPointExpressions(columns.StartMode, columns.StartLonColumn, columns.StartLatColumn, columns.StartGeometryColumn)
		endLon, endLat := flowmapPointExpressions(columns.EndMode, columns.EndLonColumn, columns.EndLatColumn, columns.EndGeometryColumn)
		return service.buildFlowmapSpatialFilterClause(
			ctx,
			runner,
			source.SpatialFilter,
			fmt.Sprintf("ST_SetSRID(ST_MakePoint(%s, %s), 4326)", startLon, startLat),
			fmt.Sprintf("ST_SetSRID(ST_MakePoint(%s, %s), 4326)", endLon, endLat),
			startParameterIndex,
		)
	}

	geometryColumns, err := service.listGeometryColumns(ctx, runner, source.Schema, source.Table)
	if err != nil {
		return nil, err
	}
	for _, geometry := range geometryColumns {
		if geometry.Name == source.GeometryColumn {
			return service.buildSpatialFilterClause(
				ctx,
				runner,
				source.SpatialFilter,
				geometryColumnWGS84Expression(geometry.Name, geometry.StorageType, geometry.SRID),
				startParameterIndex,
			)
		}
	}
	return nil, fmt.Errorf("%w: workspace geometry column not found", ErrConnectionFailed)
}
