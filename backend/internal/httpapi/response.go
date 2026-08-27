package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"geopanel/backend/internal/postgres"
)

func handleServiceError(
	writer http.ResponseWriter,
	err error,
	serviceErrorCode string,
	fallbackMessage string,
) {
	if errors.Is(err, context.DeadlineExceeded) {
		writeError(
			writer,
			http.StatusGatewayTimeout,
			"database_operation_timeout",
			"Database operation timed out. Remote database discovery and table loading can take longer on large or distant databases; try again or increase API_DB_TIMEOUT.",
		)
		return
	}

	if errors.Is(err, postgres.ErrConstraintViolation) {
		writeError(
			writer,
			http.StatusConflict,
			"database_constraint_violation",
			err.Error(),
		)
		return
	}

	if errors.Is(err, postgres.ErrConnectionFailed) {
		writeError(
			writer,
			http.StatusServiceUnavailable,
			serviceErrorCode,
			err.Error(),
		)
		return
	}

	if errors.Is(err, postgres.ErrInvalidWriteRequest) {
		writeError(
			writer,
			http.StatusUnprocessableEntity,
			serviceErrorCode,
			err.Error(),
		)
		return
	}

	if errors.Is(err, postgres.ErrWriteConflict) {
		writeError(
			writer,
			http.StatusConflict,
			"database_write_conflict",
			err.Error(),
		)
		return
	}

	writeError(
		writer,
		http.StatusInternalServerError,
		"internal_error",
		fallbackMessage,
	)
}

func writeError(
	writer http.ResponseWriter,
	statusCode int,
	code string,
	message string,
) {
	writeJSON(
		writer,
		statusCode,
		errorResponse{
			Error: apiError{
				Code:    code,
				Message: message,
			},
		},
	)
}

func writeJSON(
	writer http.ResponseWriter,
	statusCode int,
	payload any,
) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(statusCode)

	if err := json.NewEncoder(writer).Encode(payload); err != nil {
		http.Error(writer, err.Error(), http.StatusInternalServerError)
	}
}

func generateTileSourceToken() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}

	return hex.EncodeToString(bytes), nil
}

func (server *Server) pruneExpiredTileSources(now time.Time) {
	server.tileSourcesMux.Lock()
	defer server.tileSourcesMux.Unlock()

	for token, entry := range server.tileSources {
		if now.Sub(entry.createdAt) > tileSourceTTL {
			delete(server.tileSources, token)
		}
	}
}
