package postgres

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrConnectionFailed = errors.New("database connection failed")

type ConnectionTester struct {
	timeout time.Duration
}

type ConnectionTestRequest struct {
	Name     string `json:"name"`
	Host     string `json:"host"`
	Port     string `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	Password string `json:"password"`
}

type ConnectionTestResult struct {
	Success         bool   `json:"success"`
	Message         string `json:"message"`
	Database        string `json:"database"`
	Host            string `json:"host"`
	Port            string `json:"port"`
	PostgresVersion string `json:"postgresVersion"`
	PostgisVersion  string `json:"postgisVersion"`
}

func NewConnectionTester(timeout time.Duration) *ConnectionTester {
	return &ConnectionTester{
		timeout: timeout,
	}
}

func (request *ConnectionTestRequest) TrimSpaces() {
	request.Name = strings.TrimSpace(request.Name)
	request.Host = strings.TrimSpace(request.Host)
	request.Port = strings.TrimSpace(request.Port)
	request.Database = strings.TrimSpace(request.Database)
	request.User = strings.TrimSpace(request.User)
}

func (request ConnectionTestRequest) Validate() error {
	if request.Name == "" {
		return errors.New("Connection name is required.")
	}

	if request.Host == "" {
		return errors.New("Host is required.")
	}

	if request.Port == "" {
		return errors.New("Port is required.")
	}

	port, err := strconv.Atoi(request.Port)
	if err != nil || port < 1 || port > 65535 {
		return errors.New("Port must be a valid TCP port.")
	}

	if request.Database == "" {
		return errors.New("Database name is required.")
	}

	if request.User == "" {
		return errors.New("User is required.")
	}

	return nil
}

func (tester *ConnectionTester) TestConnection(
	ctx context.Context,
	request ConnectionTestRequest,
) (*ConnectionTestResult, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, tester.timeout)
	defer cancel()

	databaseURL := fmt.Sprintf(
		"postgres://%s:%s@%s:%s/%s",
		request.User,
		request.Password,
		request.Host,
		request.Port,
		request.Database,
	)

	conn, err := pgx.Connect(timeoutCtx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}
	defer conn.Close(context.Background())

	var postgresVersion string
	if err := conn.QueryRow(timeoutCtx, "select version()").Scan(&postgresVersion); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}

	var postgisVersion string
	if err := conn.QueryRow(timeoutCtx, "select postgis_version()").Scan(&postgisVersion); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
	}

	return &ConnectionTestResult{
		Success:         true,
		Message:         "Connection test passed.",
		Database:        request.Database,
		Host:            request.Host,
		Port:            request.Port,
		PostgresVersion: postgresVersion,
		PostgisVersion:  postgisVersion,
	}, nil
}
