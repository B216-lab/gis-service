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

	tester := postgres.NewConnectionTester(5 * time.Second)
	server := &http.Server{
		Addr:              addr,
		Handler:           httpapi.NewServer(tester),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("api listening on %s", addr)

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
