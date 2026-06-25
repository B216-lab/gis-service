package main

import (
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"geopanel/backend/internal/httpapi"
	"geopanel/backend/internal/postgres"
)

func main() {
	addr := envOrDefault("API_ADDR", ":18080")
	databaseTimeout := durationEnvOrDefault("API_DB_TIMEOUT", 45*time.Second)
	registeredConnections := registeredConnectionsFromEnv()

	service := postgres.NewService(databaseTimeout, registeredConnections...)
	server := &http.Server{
		Addr:              addr,
		Handler:           httpapi.NewServer(service),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("api listening on %s with database timeout %s", addr, databaseTimeout)

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("listen: %v", err)
	}
}

func envOrDefault(name string, fallback string) string {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}

	return value
}

func durationEnvOrDefault(name string, fallback time.Duration) time.Duration {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}

	duration, err := time.ParseDuration(value)
	if err != nil || duration <= 0 {
		log.Printf("invalid %s=%q, using %s", name, value, fallback)
		return fallback
	}

	return duration
}

func registeredConnectionsFromEnv() []postgres.ConnectionTestRequest {
	databaseURL := os.Getenv("GEOPANEL_DATABASE_URL")
	if databaseURL == "" {
		return nil
	}

	connection, err := connectionFromDatabaseURL(databaseURL)
	if err != nil {
		log.Printf("invalid GEOPANEL_DATABASE_URL: %v", err)
		return nil
	}

	return []postgres.ConnectionTestRequest{connection}
}

func connectionFromDatabaseURL(value string) (postgres.ConnectionTestRequest, error) {
	parsedURL, err := url.Parse(value)
	if err != nil {
		return postgres.ConnectionTestRequest{}, err
	}

	password, _ := parsedURL.User.Password()
	host := parsedURL.Hostname()
	port := parsedURL.Port()
	if port == "" {
		port = "5432"
	}
	if host == "" {
		return postgres.ConnectionTestRequest{}, net.InvalidAddrError("missing host")
	}

	database := strings.TrimPrefix(parsedURL.Path, "/")
	if database == "" {
		return postgres.ConnectionTestRequest{}, net.InvalidAddrError("missing database")
	}

	return postgres.ConnectionTestRequest{
		ID:       envOrDefault("GEOPANEL_DATABASE_ID", "primary"),
		Name:     envOrDefault("GEOPANEL_DATABASE_NAME", "Production database"),
		Host:     host,
		Port:     port,
		Database: database,
		User:     parsedURL.User.Username(),
		Password: password,
		RawQuery: parsedURL.RawQuery,
	}, nil
}
