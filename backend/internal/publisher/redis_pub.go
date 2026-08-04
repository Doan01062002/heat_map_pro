// Package publisher handles batched publishing of aggregated heatmap data to Redis.
// It runs a background flush loop that snapshots the aggregator every 1 second
// and publishes the delta to a Redis Pub/Sub channel.
package publisher

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/heat-map-pro/backend/internal/aggregator"
	"github.com/heat-map-pro/backend/internal/config"
	"github.com/redis/go-redis/v9"
)

// heatmapUpdateJSON is the JSON structure published to Redis
// and ultimately pushed to admin WebSocket clients.
type heatmapUpdateJSON struct {
	Cells           []cellJSON `json:"cells"`
	ServerTimestamp  int64      `json:"server_timestamp"`
	TotalDrivers    uint32     `json:"total_drivers"`
	TotalDeviations uint32     `json:"total_deviations"`
}

type cellJSON struct {
	H3Index     string `json:"h3_index"`
	Intensity   uint32 `json:"intensity"`
	LastUpdated int64  `json:"last_updated"`
}

// RedisPublisher publishes aggregated heatmap data to a Redis Pub/Sub channel.
type RedisPublisher struct {
	client  *redis.Client
	channel string
}

// NewRedisPublisher creates a new Redis publisher and verifies the connection.
func NewRedisPublisher(ctx context.Context, cfg *config.Config) (*RedisPublisher, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})

	// Verify connection
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redisPublisher: connect: %w", err)
	}

	slog.Info("redis connected", "addr", cfg.RedisAddr)

	return &RedisPublisher{
		client:  client,
		channel: cfg.RedisChannel,
	}, nil
}

// StartFlushLoop runs a background loop that snapshots the aggregator
// and publishes to Redis at the given interval (default: 1 second).
//
// This function blocks until the context is cancelled.
func (p *RedisPublisher) StartFlushLoop(ctx context.Context, agg *aggregator.Aggregator, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	slog.Info("redis flush loop started", "interval", interval)

	for {
		select {
		case <-ctx.Done():
			slog.Info("redis flush loop stopped")
			return
		case <-ticker.C:
			p.flush(ctx, agg)
		}
	}
}

// flush takes a snapshot of the aggregator and publishes it to Redis.
func (p *RedisPublisher) flush(ctx context.Context, agg *aggregator.Aggregator) {
	snapshot := agg.Snapshot()
	if len(snapshot) == 0 {
		return // Nothing to publish
	}

	now := time.Now().UnixMilli()

	cells := make([]cellJSON, len(snapshot))
	var totalDeviations uint32
	for i, s := range snapshot {
		cells[i] = cellJSON{
			H3Index:     s.H3Index,
			Intensity:   uint32(s.Intensity),
			LastUpdated: now,
		}
		totalDeviations += uint32(s.Intensity)
	}

	update := heatmapUpdateJSON{
		Cells:           cells,
		ServerTimestamp:  now,
		TotalDrivers:    0, // TODO: Get from ingestion handler
		TotalDeviations: totalDeviations,
	}

	data, err := json.Marshal(update)
	if err != nil {
		slog.Error("redis flush: marshal failed", "error", err)
		return
	}

	if err := p.client.Publish(ctx, p.channel, data).Err(); err != nil {
		slog.Error("redis flush: publish failed", "error", err, "channel", p.channel)
		return
	}

	slog.Debug("redis flush: published",
		"cells", len(cells),
		"total_deviations", totalDeviations,
	)
}

// Close closes the Redis connection.
func (p *RedisPublisher) Close() error {
	return p.client.Close()
}
