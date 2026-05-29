package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"geopanel/backend/internal/httpapi"
	"geopanel/backend/internal/postgres"
)

func main() {
	addr := envOrDefault("API_ADDR", ":18080")
	databaseTimeout := durationEnvOrDefault("API_DB_TIMEOUT", 45*time.Second)

	service := postgres.NewService(databaseTimeout)
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
