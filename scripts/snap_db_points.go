package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Point struct {
	ID  int64   `json:"id"`
	Lat float64 `json:"latitude"`
	Lng float64 `json:"longitude"`
}

type OSRMNearest struct {
	Code      string `json:"code"`
	Waypoints []struct {
		Location [2]float64 `json:"location"` // [lng, lat]
	} `json:"waypoints"`
}

func main() {
	ctx := context.Background()

	pgHost := getEnv("POSTGRES_HOST", "localhost")
	pgPort := getEnv("POSTGRES_PORT", "5432")
	pgUser := getEnv("POSTGRES_USER", "heatmap")
	pgPass := getEnv("POSTGRES_PASSWORD", "heatmap_secret_2024")
	pgDB := getEnv("POSTGRES_DB", "heatmap_db")
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable", pgUser, pgPass, pgHost, pgPort, pgDB)

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatalf("PostgreSQL connect failed: %v", err)
	}
	defer pool.Close()

	log.Printf("Connecting to PostgreSQL to fetch deviation_events...")

	rows, err := pool.Query(ctx, "SELECT id, latitude, longitude FROM deviation_events ORDER BY id")
	if err != nil {
		log.Fatalf("Query failed: %v", err)
	}
	defer rows.Close()

	var points []Point
	for rows.Next() {
		var p Point
		if err := rows.Scan(&p.ID, &p.Lat, &p.Lng); err == nil {
			points = append(points, p)
		}
	}
	log.Printf("Fetched %d points from DB. Snapping to road network via OSRM...", len(points))

	client := &http.Client{Timeout: 5 * time.Second}

	// Concurrency worker pool
	concurrency := 150
	jobs := make(chan Point, 5000)
	results := make(chan Point, 5000)
	var wg sync.WaitGroup

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for pt := range jobs {
				url := fmt.Sprintf("https://router.project-osrm.org/nearest/v1/driving/%.6f,%.6f?number=1", pt.Lng, pt.Lat)
				for retry := 0; retry < 2; retry++ {
					resp, err := client.Get(url)
					if err == nil && resp.StatusCode == 200 {
						var osrmRes OSRMNearest
						if json.NewDecoder(resp.Body).Decode(&osrmRes) == nil && len(osrmRes.Waypoints) > 0 {
							pt.Lng = osrmRes.Waypoints[0].Location[0]
							pt.Lat = osrmRes.Waypoints[0].Location[1]
						}
						resp.Body.Close()
						break
					}
					if resp != nil {
						resp.Body.Close()
					}
					time.Sleep(50 * time.Millisecond)
				}
				results <- pt
			}
		}()
	}

	go func() {
		for _, pt := range points {
			jobs <- pt
		}
		close(jobs)
		wg.Wait()
		close(results)
	}()

	// Batch update DB
	var batch []Point
	updated := 0
	startTime := time.Now()

	for pt := range results {
		batch = append(batch, pt)
		if len(batch) >= 1000 {
			updated += updateBatch(ctx, pool, batch)
			batch = batch[:0]
			log.Printf("Progress: snapped and updated %d/%d points (%.1f%%)...", updated, len(points), float64(updated)/float64(len(points))*100)
		}
	}
	if len(batch) > 0 {
		updated += updateBatch(ctx, pool, batch)
	}

	log.Printf("🎉 Successfully snapped and updated %d points in DB in %v!", updated, time.Since(startTime))
}

func updateBatch(ctx context.Context, pool *pgxpool.Pool, batch []Point) int {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0
	}
	defer tx.Rollback(ctx)

	for _, pt := range batch {
		_, err := tx.Exec(ctx, "UPDATE deviation_events SET latitude = $1, longitude = $2 WHERE id = $3", pt.Lat, pt.Lng, pt.ID)
		if err != nil {
			return 0
		}
	}
	tx.Commit(ctx)
	return len(batch)
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
