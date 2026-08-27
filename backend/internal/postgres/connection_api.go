package postgres

import (
	"context"
	"fmt"
	"slices"
	"strings"
)

func (service *Service) TestConnection(
	ctx context.Context,
	request ConnectionTestRequest,
) (*ConnectionTestResult, error) {
	resolvedRequest, err := service.resolveConnectionRequest(request)
	if err != nil {
		return nil, err
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, service.timeout)
	defer cancel()

	conn, err := service.connect(timeoutCtx, resolvedRequest)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())

	var postgresVersion string
	if err := conn.QueryRow(timeoutCtx, "select version()").Scan(&postgresVersion); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	var postgisVersion string
	if err := conn.QueryRow(timeoutCtx, "select postgis_version()").Scan(&postgisVersion); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnectionFailed, err)
	}

	return &ConnectionTestResult{
		Success:         true,
		Message:         "Connection test passed.",
		PostgresVersion: postgresVersion,
		PostgisVersion:  postgisVersion,
	}, nil
}

func (service *Service) ListRegisteredConnections() *ListRegisteredConnectionsResult {
	connections := make([]RegisteredConnectionSummary, 0, len(service.registeredConnections))
	for _, connection := range service.registeredConnections {
		connections = append(connections, RegisteredConnectionSummary{
			ID:   connection.ID,
			Name: connection.Name,
		})
	}

	slices.SortFunc(connections, func(left, right RegisteredConnectionSummary) int {
		return strings.Compare(left.Name, right.Name)
	})

	return &ListRegisteredConnectionsResult{
		Connections: connections,
	}
}
