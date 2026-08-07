// Package config loads and validates application configuration from environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds all application configuration.
// All values are loaded from environment variables with sensible defaults.
type Config struct {
	// General
	AppEnv   string // "development" or "production"
	LogLevel string // "debug", "info", "warn", "error"

	// Backend Server
	BackendHost string
	BackendPort int

	// OSRM
	OSRMURL           string
	OSRMMatchTimeoutMS int

	// Redis
	RedisAddr     string
	RedisPassword string
	RedisDB       int
	RedisChannel  string

	// PostgreSQL
	PostgresHost     string
	PostgresPort     int
	PostgresUser     string
	PostgresPassword string
	PostgresDB       string
	PostgresSSLMode  string

	// H3 Spatial Indexing
	H3Resolution int

	// Aggregation Timing
	FlushIntervalRedisMS  int
	FlushIntervalPostgresS int

	// Filtering
	BBoxBufferMeters        float64
	DeviationThresholdMeters float64
}

// DSN returns the PostgreSQL connection string.
func (c *Config) DSN() string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		c.PostgresUser, c.PostgresPassword,
		c.PostgresHost, c.PostgresPort,
		c.PostgresDB, c.PostgresSSLMode,
	)
}

// Load reads configuration from environment variables (loading .env if present).
// Returns an error if a required variable is missing or invalid.
func Load() (*Config, error) {
	loadDotEnv()

	cfg := &Config{
		AppEnv:                   getEnv("APP_ENV", "development"),
		LogLevel:                 getEnv("LOG_LEVEL", "debug"),
		BackendHost:              getEnv("BACKEND_HOST", "0.0.0.0"),
		BackendPort:              getEnvInt("BACKEND_PORT", 8080),
		OSRMURL:                  getEnv("OSRM_URL", "http://127.0.0.1:5000"),
		OSRMMatchTimeoutMS:       getEnvInt("OSRM_MATCH_TIMEOUT_MS", 500),
		RedisAddr:                getEnv("REDIS_ADDR", "127.0.0.1:6379"),
		RedisPassword:            getEnv("REDIS_PASSWORD", ""),
		RedisDB:                  getEnvInt("REDIS_DB", 0),
		RedisChannel:             getEnv("REDIS_CHANNEL", "heatmap:updates"),
		PostgresHost:             getEnv("POSTGRES_HOST", "127.0.0.1"),
		PostgresPort:             getEnvInt("POSTGRES_PORT", 5432),
		PostgresUser:             getEnv("POSTGRES_USER", "heatmap"),
		PostgresPassword:         getEnv("POSTGRES_PASSWORD", "heatmap_secret_2024"),
		PostgresDB:               getEnv("POSTGRES_DB", "heatmap_db"),
		PostgresSSLMode:          getEnv("POSTGRES_SSLMODE", "disable"),
		H3Resolution:            getEnvInt("H3_RESOLUTION", 8),
		FlushIntervalRedisMS:    getEnvInt("FLUSH_INTERVAL_REDIS_MS", 1000),
		FlushIntervalPostgresS:  getEnvInt("FLUSH_INTERVAL_POSTGRES_S", 30),
		BBoxBufferMeters:        getEnvFloat("BBOX_BUFFER_METERS", 50.0),
		DeviationThresholdMeters: getEnvFloat("DEVIATION_THRESHOLD_METERS", 50.0),
	}

	// Validate critical values
	if cfg.H3Resolution < 0 || cfg.H3Resolution > 15 {
		return nil, fmt.Errorf("config: H3_RESOLUTION must be 0-15, got %d", cfg.H3Resolution)
	}

	if cfg.BackendPort < 1 || cfg.BackendPort > 65535 {
		return nil, fmt.Errorf("config: BACKEND_PORT must be 1-65535, got %d", cfg.BackendPort)
	}

	return cfg, nil
}

// getEnv reads an environment variable with a default fallback.
func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

// getEnvInt reads an integer environment variable with a default fallback.
func getEnvInt(key string, defaultVal int) int {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return defaultVal
	}
	return n
}

// getEnvFloat reads a float64 environment variable with a default fallback.
func getEnvFloat(key string, defaultVal float64) float64 {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	f, err := strconv.ParseFloat(val, 64)
	if err != nil {
		return defaultVal
	}
	return f
}

// loadDotEnv reads .env file from working dir or parent dir if present.
func loadDotEnv() {
	paths := []string{".env", "../.env", "../../.env"}
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		lines := strings.Split(string(data), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				k := strings.TrimSpace(parts[0])
				v := strings.TrimSpace(parts[1])
				if os.Getenv(k) == "" {
					os.Setenv(k, v)
				}
			}
		}
		break
	}
}
