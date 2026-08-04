// Package websocket manages the admin WebSocket hub.
// It subscribes to Redis Pub/Sub for heatmap updates and broadcasts
// them to all connected admin dashboard clients.
package websocket

import (
	"context"
	"log/slog"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/heat-map-pro/backend/internal/config"
	"github.com/redis/go-redis/v9"
)

// Hub manages WebSocket connections for admin dashboard clients.
// It subscribes to a Redis Pub/Sub channel and broadcasts messages
// to all connected clients.
type Hub struct {
	cfg    *config.Config
	rdb    *redis.Client

	mu      sync.RWMutex
	clients map[*websocket.Conn]bool

	upgrader websocket.Upgrader
}

// NewHub creates a new WebSocket hub.
func NewHub(ctx context.Context, cfg *config.Config) *Hub {
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})

	return &Hub{
		cfg:     cfg,
		rdb:     rdb,
		clients: make(map[*websocket.Conn]bool),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 4096,
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins for demo
			},
		},
	}
}

// HandleWebSocket upgrades the HTTP connection and registers the client.
func (h *Hub) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("admin websocket upgrade failed", "error", err)
		return
	}

	h.mu.Lock()
	h.clients[conn] = true
	clientCount := len(h.clients)
	h.mu.Unlock()

	slog.Info("admin client connected", "remote_addr", r.RemoteAddr, "total_clients", clientCount)

	// Keep the connection alive by reading (and discarding) any incoming messages.
	// Admin clients only receive data, they don't send anything meaningful.
	defer func() {
		h.mu.Lock()
		delete(h.clients, conn)
		h.mu.Unlock()
		conn.Close()
		slog.Info("admin client disconnected", "remote_addr", r.RemoteAddr)
	}()

	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			return // Client disconnected
		}
	}
}

// StartSubscriber subscribes to the Redis Pub/Sub channel and broadcasts
// received messages to all connected admin clients.
//
// This function blocks until the context is cancelled.
func (h *Hub) StartSubscriber(ctx context.Context) {
	pubsub := h.rdb.Subscribe(ctx, h.cfg.RedisChannel)
	defer pubsub.Close()

	ch := pubsub.Channel()

	slog.Info("websocket hub: subscribed to Redis channel", "channel", h.cfg.RedisChannel)

	for {
		select {
		case <-ctx.Done():
			slog.Info("websocket hub: subscriber stopped")
			return
		case msg, ok := <-ch:
			if !ok {
				slog.Warn("websocket hub: Redis channel closed")
				return
			}
			h.broadcast([]byte(msg.Payload))
		}
	}
}

// broadcast sends a message to all connected admin WebSocket clients.
// Clients that fail to receive the message are disconnected.
func (h *Hub) broadcast(data []byte) {
	h.mu.RLock()
	clients := make([]*websocket.Conn, 0, len(h.clients))
	for conn := range h.clients {
		clients = append(clients, conn)
	}
	h.mu.RUnlock()

	if len(clients) == 0 {
		return
	}

	var failedConns []*websocket.Conn

	for _, conn := range clients {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			slog.Debug("websocket broadcast: write failed", "error", err)
			failedConns = append(failedConns, conn)
		}
	}

	// Remove failed connections
	if len(failedConns) > 0 {
		h.mu.Lock()
		for _, conn := range failedConns {
			delete(h.clients, conn)
			conn.Close()
		}
		h.mu.Unlock()
	}

	slog.Debug("websocket broadcast: sent to clients",
		"sent", len(clients)-len(failedConns),
		"failed", len(failedConns),
		"bytes", len(data),
	)
}

// ClientCount returns the number of currently connected admin clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
