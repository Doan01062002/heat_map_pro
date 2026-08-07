// Package main is the entry point for the heatmap backend server.
// It wires all dependencies together and starts the HTTP/WebSocket server.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/heat-map-pro/backend/internal/aggregator"
	"github.com/heat-map-pro/backend/internal/auth"
	"github.com/heat-map-pro/backend/internal/config"
	"github.com/heat-map-pro/backend/internal/filter"
	"github.com/heat-map-pro/backend/internal/ingestion"
	"github.com/heat-map-pro/backend/internal/persistence"
	"github.com/heat-map-pro/backend/internal/publisher"
	"github.com/heat-map-pro/backend/internal/spatial"
	"github.com/heat-map-pro/backend/internal/websocket"
)

func main() {
	// ---- Load Configuration ----
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// ---- Setup Logger ----
	logLevel := slog.LevelInfo
	switch cfg.LogLevel {
	case "debug":
		logLevel = slog.LevelDebug
	case "warn":
		logLevel = slog.LevelWarn
	case "error":
		logLevel = slog.LevelError
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel}))
	slog.SetDefault(logger)

	slog.Info("starting heatmap backend",
		"env", cfg.AppEnv,
		"port", cfg.BackendPort,
		"h3_resolution", cfg.H3Resolution,
	)

	// ---- Create Root Context (for graceful shutdown) ----
	startTime := time.Now()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// ---- Initialize Dependencies ----

	// 1. Spatial Indexer
	h3Indexer := spatial.NewH3Indexer(cfg.H3Resolution)

	// 2. Lock-Free Aggregator
	agg := aggregator.New()

	// 3. OSRM Client
	osrmClient := filter.NewOSRMClient(cfg.OSRMURL, time.Duration(cfg.OSRMMatchTimeoutMS)*time.Millisecond)

	// 4. Bounding Box Filter
	bboxFilter := filter.NewBoundingBoxFilter(cfg.BBoxBufferMeters)

	// 5. Redis Publisher (1s flush)
	redisPub, err := publisher.NewRedisPublisher(ctx, cfg)
	if err != nil {
		slog.Error("failed to connect to Redis", "error", err)
		os.Exit(1)
	}
	defer redisPub.Close()

	// 6. PostgreSQL Persistence (30s flush)
	pgWriter, err := persistence.NewPostgresWriter(ctx, cfg)
	if err != nil {
		slog.Error("failed to connect to PostgreSQL", "error", err)
		os.Exit(1)
	}
	defer pgWriter.Close()

	// 7. Admin WebSocket Hub
	wsHub := websocket.NewHub(ctx, cfg)

	// 8. Persistence Adapter (bridges ingestion → persistence without circular import)
	pgAdapter := persistence.NewAdapter(pgWriter)

	// 9. Ingestion Handler (wires filter → spatial → aggregator → persister)
	ingestHandler := ingestion.NewHandler(bboxFilter, osrmClient, h3Indexer, agg, pgAdapter, cfg)

	// 10. Auth Repository & Handler
	authRepo := auth.NewRepository(pgWriter.Pool())
	authHandler := auth.NewHandler(authRepo)

	// ---- Wire Cross-Component Dependencies ----
	redisPub.SetDriverCounter(ingestHandler)

	pgWriter.SetOnTripSaved(func(trip persistence.TripPayload) {
		msg, err := json.Marshal(map[string]interface{}{
			"type": "new_trip",
			"trip": trip,
		})
		if err == nil {
			_ = redisPub.PublishRaw(ctx, msg)
		}
	})

	// ---- Start Background Workers ----
	go redisPub.StartFlushLoop(ctx, agg, time.Duration(cfg.FlushIntervalRedisMS)*time.Millisecond)
	go pgWriter.StartFlushLoop(ctx, agg, time.Duration(cfg.FlushIntervalPostgresS)*time.Second)
	go wsHub.StartSubscriber(ctx) // Subscribes to Redis and broadcasts to admin clients

	// ---- Setup HTTP Routes ----
	mux := http.NewServeMux()

	// Driver Authentication
	mux.HandleFunc("POST /api/auth/register", authHandler.Register)
	mux.HandleFunc("POST /api/auth/login", authHandler.Login)
	mux.HandleFunc("GET /api/auth/me", authHandler.Me)

	// Health check
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"status":"healthy","uptime_seconds":%d,"active_drivers":%d}`,
			int(time.Since(startTime).Seconds()),
			ingestHandler.ActiveDriverCount(),
		)
	})

	// Trip saving & retrieval
	mux.HandleFunc("POST /api/trips", pgWriter.HandleSaveTrip)
	mux.HandleFunc("GET /api/trips", pgWriter.HandleGetTrips)

	// Historical heatmap query
	mux.HandleFunc("GET /api/history", pgWriter.HandleHistoryQuery)

	// Driver deviation events query
	mux.HandleFunc("GET /api/deviations", pgWriter.HandleDeviationsQuery)

	// Raw GPS points for heatmap (naturally road-following)
	mux.HandleFunc("GET /api/points", pgWriter.HandlePointsQuery)

	// Per-trip GPS trajectories as GeoJSON LineStrings
	mux.HandleFunc("GET /api/trajectories", pgWriter.HandleTrajectoriesQuery)

	// Road segment statistics for map click popup (Vietnamese stats)
	mux.HandleFunc("GET /api/road-stats", pgWriter.HandleRoadStatsQuery)

	// Hourly avoidance statistics for 24-hour chart
	mux.HandleFunc("GET /api/hourly-stats", pgWriter.HandleHourlyStatsQuery)

	// AI Agent Investigation Proxy
	mux.HandleFunc("POST /api/ai/investigate", func(w http.ResponseWriter, r *http.Request) {
		aiURL := os.Getenv("AI_AGENT_URL")
		if aiURL == "" {
			aiURL = "http://localhost:8090"
		}
		proxyReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, aiURL+"/investigate", r.Body)
		if err != nil {
			http.Error(w, `{"error":"failed to create proxy request"}`, http.StatusInternalServerError)
			return
		}
		proxyReq.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(proxyReq)
		if err != nil {
			slog.Error("ai agent service call failed", "error", err, "url", aiURL)
			http.Error(w, `{"error":"AI service unavailable"}`, http.StatusServiceUnavailable)
			return
		}
		defer resp.Body.Close()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	})

	// WebSocket: Driver GPS ingestion
	mux.HandleFunc("/ws/driver", ingestHandler.HandleWebSocket)

	// WebSocket: Admin heatmap stream
	mux.HandleFunc("/ws/admin", wsHub.HandleWebSocket)

	// ---- Start HTTP Server ----
	addr := fmt.Sprintf("%s:%d", cfg.BackendHost, cfg.BackendPort)

	// CORS middleware for development (frontend on different port)
	corsHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		mux.ServeHTTP(w, r)
	})

	server := &http.Server{
		Addr:         addr,
		Handler:      corsHandler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in a goroutine
	go func() {
		slog.Info("HTTP server listening", "addr", addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("HTTP server error", "error", err)
			cancel()
		}
	}()

	// ---- Graceful Shutdown ----
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	slog.Info("shutting down gracefully...")
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("HTTP server shutdown error", "error", err)
	}

	slog.Info("server stopped")
}
