package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"geopanel/backend/internal/analytics"
	"geopanel/backend/internal/auth"
	"geopanel/backend/internal/httpapi"
	"geopanel/backend/internal/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	addr := envOrDefault("API_ADDR", ":18080")
	databaseTimeout := durationEnvOrDefault("API_DB_TIMEOUT", 45*time.Second)
	registeredConnections := registeredConnectionsFromEnv()

	service := postgres.NewService(databaseTimeout, registeredConnections...)
	store, err := analytics.OpenStore(envOrDefault("ANALYTICS_METADATA_PATH", "data/analytics.json"))
	if err != nil {
		log.Fatalf("analytics metadata: %v", err)
	}
	legacyAPI := httpapi.NewServer(service)
	analyticsHandler := analytics.NewHandler(store)
	queries := analytics.RegisterQueryRoutes(analyticsHandler, store, service)
	analytics.RegisterPublicationRoutes(analyticsHandler, queries)
	analytics.RegisterImportRoutes(analyticsHandler, service)
	legacyAPI.Handle("/api/v1/analytics/", analyticsHandler)

	config, err := auth.RuntimeConfigFromEnv()
	if err != nil {
		log.Fatalf("auth configuration: %v", err)
	}
	authPool, err := openAuthPool(context.Background(), os.Getenv("GEOPANEL_DATABASE_URL"))
	if err != nil {
		log.Fatalf("auth database: %v", err)
	}
	defer authPool.Close()
	if err := auth.EnsurePostgreSQLSchema(context.Background(), authPool); err != nil {
		log.Fatalf("auth database: %v", err)
	}
	sessions, err := auth.NewPostgreSQLSessionStoreWithSecret(authPool, config.SessionSecret)
	if err != nil {
		log.Fatalf("auth sessions: %v", err)
	}
	apiTokens, err := auth.NewPostgreSQLAPITokenStore(authPool)
	if err != nil {
		log.Fatalf("auth API tokens: %v", err)
	}
	flows, err := auth.NewPostgreSQLFlowStore(authPool)
	if err != nil {
		log.Fatalf("auth OIDC flows: %v", err)
	}
	workspaceAuthz, err := auth.NewPostgreSQLWorkspaceAuthorizer(authPool)
	if err != nil {
		log.Fatalf("auth workspace authorization: %v", err)
	}
	oidcAuthenticator, err := auth.NewOIDCAuthenticator(context.Background(), config.OIDCConfig)
	if err != nil {
		log.Fatalf("OIDC authenticator: %v", err)
	}
	exchanger, authURL, err := auth.NewBrowserOIDCCodeExchanger(context.Background(), config.OIDCConfig)
	if err != nil {
		log.Fatalf("OIDC browser flow: %v", err)
	}
	browser, err := auth.NewBrowserOIDCHandler(auth.BrowserAuthConfig{
		RedirectURL: config.RedirectURL, ClientSecret: config.ClientSecret,
		FlowTTL: 10 * time.Minute, SessionTTL: 8 * time.Hour, SecureCookie: true,
	}, authURL, exchanger, flows, sessions)
	if err != nil {
		log.Fatalf("OIDC browser handler: %v", err)
	}
	authenticator := auth.NewCompositeAuthenticator(browser.SessionAuthenticator(), auth.NewBearerAuthenticator(oidcAuthenticator, apiTokens))
	mux := newRootHandler(legacyAPI, auth.NewHTTPHandlerWithTokens(browser, authenticator, apiTokens, workspaceAuthz), authenticator)
	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("api listening on %s with database timeout %s", addr, databaseTimeout)

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("listen: %v", err)
	}
}

func openAuthPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	if strings.TrimSpace(databaseURL) == "" {
		return nil, fmt.Errorf("GEOPANEL_DATABASE_URL is required")
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping pool: %w", err)
	}
	return pool, nil
}

func newRootHandler(api, authRoutes http.Handler, authenticator auth.Authenticator) http.Handler {
	root := http.NewServeMux()
	root.Handle("/auth/", authRoutes)
	root.Handle("/api/v1/auth/me", authRoutes)
	root.Handle("/api/v1/auth/tokens", authRoutes)
	root.Handle("/api/v1/auth/tokens/", authRoutes)
	root.Handle("/api/v1/health", api)
	// TODO: Route ownership outside health/share is still legacy. Protect it
	// until individual public endpoints are explicitly specified.
	root.Handle("/api/v1/analytics/public/", api)
	root.Handle("/api/", auth.Middleware(authenticator, auth.Require(api)))
	return root
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
