// Package main — Porto Taxi Data Loader
//
// Reads train.csv.zip, extracts ~2000 trips, computes H3 cells,
// inserts deviation events directly into PostgreSQL,
// and publishes aggregated heatmap to Redis for live dashboard.
//
// Usage:
//   go run scripts/load_porto_data.go -file train.csv.zip -trips 2000
package main

import (
	"archive/zip"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Cell size for H3 Resolution 8 (~460m)
const cellSizeDeg = 0.00414

func main() {
	zipFile := "train.csv.zip"
	maxTrips := 2000

	if len(os.Args) > 1 {
		for i, arg := range os.Args {
			if arg == "-file" && i+1 < len(os.Args) {
				zipFile = os.Args[i+1]
			}
			if arg == "-trips" && i+1 < len(os.Args) {
				n, _ := strconv.Atoi(os.Args[i+1])
				if n > 0 {
					maxTrips = n
				}
			}
		}
	}

	ctx := context.Background()

	log.Printf("=== Porto Taxi Data Loader ===")
	log.Printf("File: %s", zipFile)
	log.Printf("Max trips: %d", maxTrips)

	// --- Connect PostgreSQL ---
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
	log.Printf("PostgreSQL connected: %s:%s/%s", pgHost, pgPort, pgDB)

	// --- Connect Redis ---
	redisAddr := getEnv("REDIS_ADDR", "localhost:6379")
	redisChannel := getEnv("REDIS_CHANNEL", "heatmap:updates")
	rdb := redis.NewClient(&redis.Options{Addr: redisAddr})
	defer rdb.Close()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("Redis connect failed: %v", err)
	}
	log.Printf("Redis connected: %s", redisAddr)

	// --- Load trips from ZIP ---
	trips, err := loadTripsFromZip(zipFile, maxTrips)
	if err != nil {
		log.Fatalf("Load trips failed: %v", err)
	}
	log.Printf("Loaded %d valid trips", len(trips))

	// --- Process trips ---
	cellCounts := make(map[string]int) // H3 cell → deviation count
	totalPoints := 0
	totalDeviations := 0
	batchSize := 500
	batchValues := make([]string, 0, batchSize)
	batchArgs := make([]interface{}, 0, batchSize*9)
	argIdx := 1
	insertedRows := 0

	for i, trip := range trips {
		poly := trip.Polyline
		if len(poly) < 5 {
			continue
		}

		// Calculate the "expected path" — straight line from start to end
		startLat, startLng := poly[0][1], poly[0][0]
		endLat, endLng := poly[len(poly)-1][1], poly[len(poly)-1][0]

		for j, coord := range poly {
			lng, lat := coord[0], coord[1]
			totalPoints++

			// Calculate deviation from straight-line path (simplified)
			deviation := pointToLineDistance(lat, lng, startLat, startLng, endLat, endLng)

			// Only record as deviation if > 50m from straight-line path
			if deviation < 50 {
				continue
			}

			totalDeviations++

			// Compute H3 cell
			h3Cell := latLngToCell(lat, lng)
			cellCounts[h3Cell]++

			// Build batch insert
			driverID := fmt.Sprintf("taxi-%s", trip.TaxiID)
			heading := float64(0)
			if j+1 < len(poly) {
				heading = bearing(lat, lng, poly[j+1][1], poly[j+1][0])
			}
			speed := 20.0 + float64(j%40) // 20-60 km/h simulated

			batchValues = append(batchValues, fmt.Sprintf(
				"($%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d)",
				argIdx, argIdx+1, argIdx+2, argIdx+3, argIdx+4, argIdx+5, argIdx+6, argIdx+7, argIdx+8,
			))
			batchArgs = append(batchArgs,
				driverID, trip.TripID, lat, lng, h3Cell, deviation, heading, speed,
				time.Unix(trip.Timestamp+int64(j*15), 0), // 15s between points
			)
			argIdx += 9

			// Flush batch
			if len(batchValues) >= batchSize {
				insertedRows += flushBatch(ctx, pool, batchValues, batchArgs)
				batchValues = batchValues[:0]
				batchArgs = batchArgs[:0]
				argIdx = 1
			}
		}

		// Progress log
		if (i+1)%200 == 0 {
			log.Printf("  Processed %d/%d trips (%.0f%%), %d deviations found",
				i+1, len(trips), float64(i+1)/float64(len(trips))*100, totalDeviations)
		}
	}

	// Flush remaining
	if len(batchValues) > 0 {
		insertedRows += flushBatch(ctx, pool, batchValues, batchArgs)
	}

	log.Printf("=== PostgreSQL Insert Complete ===")
	log.Printf("Total points: %d", totalPoints)
	log.Printf("Total deviations: %d", totalDeviations)
	log.Printf("Rows inserted: %d", insertedRows)
	log.Printf("Unique H3 cells: %d", len(cellCounts))

	// --- Publish heatmap to Redis ---
	type cellJSON struct {
		H3Index     string `json:"h3_index"`
		Intensity   int    `json:"intensity"`
		LastUpdated int64  `json:"last_updated"`
	}
	type updateJSON struct {
		Cells           []cellJSON `json:"cells"`
		ServerTimestamp  int64      `json:"server_timestamp"`
		TotalDrivers    int        `json:"total_drivers"`
		TotalDeviations int        `json:"total_deviations"`
	}

	now := time.Now().UnixMilli()

	// Publish in chunks (Redis message size limit)
	allCells := make([]cellJSON, 0, len(cellCounts))
	for cell, count := range cellCounts {
		allCells = append(allCells, cellJSON{
			H3Index:     cell,
			Intensity:   count,
			LastUpdated: now,
		})
	}

	chunkSize := 200
	for i := 0; i < len(allCells); i += chunkSize {
		end := i + chunkSize
		if end > len(allCells) {
			end = len(allCells)
		}

		update := updateJSON{
			Cells:           allCells[i:end],
			ServerTimestamp:  now,
			TotalDrivers:    len(trips),
			TotalDeviations: totalDeviations,
		}

		data, _ := json.Marshal(update)
		if err := rdb.Publish(ctx, redisChannel, data).Err(); err != nil {
			log.Printf("Redis publish error: %v", err)
		}

		// Small delay between chunks
		time.Sleep(100 * time.Millisecond)
	}

	log.Printf("=== Redis Publish Complete ===")
	log.Printf("Published %d cells in %d chunks to channel '%s'",
		len(allCells), (len(allCells)+chunkSize-1)/chunkSize, redisChannel)

	// --- Verify ---
	var count int
	pool.QueryRow(ctx, "SELECT COUNT(*) FROM deviation_events").Scan(&count)
	log.Printf("=== Verification: %d rows in deviation_events table ===", count)

	// Top 10 hottest cells
	log.Printf("=== Top 10 Hottest H3 Cells ===")
	rows, _ := pool.Query(ctx, `
		SELECT h3_index, COUNT(*) as cnt, COUNT(DISTINCT driver_id) as drivers
		FROM deviation_events
		GROUP BY h3_index
		ORDER BY cnt DESC
		LIMIT 10
	`)
	defer rows.Close()
	for rows.Next() {
		var cell string
		var cnt, drivers int
		rows.Scan(&cell, &cnt, &drivers)
		log.Printf("  %s → %d deviations (%d unique drivers)", cell, cnt, drivers)
	}

	log.Printf("🎉 Done! Open http://localhost:3002/admin/ to see the heatmap!")
}

func flushBatch(ctx context.Context, pool *pgxpool.Pool, values []string, args []interface{}) int {
	query := fmt.Sprintf(`
		INSERT INTO deviation_events (driver_id, trip_id, latitude, longitude, h3_index, deviation_meters, heading, speed_kmh, created_at)
		VALUES %s
	`, strings.Join(values, ","))

	_, err := pool.Exec(ctx, query, args...)
	if err != nil {
		log.Printf("Batch insert error: %v", err)
		return 0
	}
	return len(values)
}

// --- Spatial ---

func latLngToCell(lat, lng float64) string {
	latGrid := int(math.Floor((lat + 90.0) / cellSizeDeg))
	lngGrid := int(math.Floor(lng / cellSizeDeg))
	if lngGrid < 0 {
		lngGrid += int(math.Floor(360.0 / cellSizeDeg))
	}
	return fmt.Sprintf("H8:%d:%d", latGrid, lngGrid)
}

// --- Geometry ---

func pointToLineDistance(pLat, pLng, aLat, aLng, bLat, bLng float64) float64 {
	// Project point onto line segment AB, return distance in meters
	abLat := bLat - aLat
	abLng := bLng - aLng
	apLat := pLat - aLat
	apLng := pLng - aLng

	abLen2 := abLat*abLat + abLng*abLng
	if abLen2 == 0 {
		return haversine(pLat, pLng, aLat, aLng)
	}

	t := (apLat*abLat + apLng*abLng) / abLen2
	if t < 0 {
		t = 0
	} else if t > 1 {
		t = 1
	}

	projLat := aLat + t*abLat
	projLng := aLng + t*abLng

	return haversine(pLat, pLng, projLat, projLng)
}

func haversine(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371000.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	return R * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func bearing(lat1, lng1, lat2, lng2 float64) float64 {
	dLng := (lng2 - lng1) * math.Pi / 180
	y := math.Sin(dLng) * math.Cos(lat2*math.Pi/180)
	x := math.Cos(lat1*math.Pi/180)*math.Sin(lat2*math.Pi/180) -
		math.Sin(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*math.Cos(dLng)
	return math.Mod(math.Atan2(y, x)*180/math.Pi+360, 360)
}

// --- CSV ---

type trip struct {
	TripID    string
	TaxiID    string
	Timestamp int64
	Polyline  [][2]float64
}

func loadTripsFromZip(zipPath string, maxTrips int) ([]trip, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}
	defer zr.Close()

	f, err := zr.File[0].Open()
	if err != nil {
		return nil, fmt.Errorf("open csv: %w", err)
	}
	defer f.Close()

	reader := csv.NewReader(f)
	reader.LazyQuotes = true

	header, err := reader.Read()
	if err != nil {
		return nil, err
	}

	colIdx := make(map[string]int)
	for i, h := range header {
		colIdx[strings.TrimSpace(h)] = i
	}

	var trips []trip
	for len(trips) < maxTrips {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		if strings.TrimSpace(record[colIdx["MISSING_DATA"]]) == "True" {
			continue
		}

		polyStr := record[colIdx["POLYLINE"]]
		if polyStr == "[]" || polyStr == "" {
			continue
		}

		var polyline [][2]float64
		if err := json.Unmarshal([]byte(polyStr), &polyline); err != nil {
			continue
		}

		if len(polyline) < 10 { // Skip very short trips
			continue
		}

		ts, _ := strconv.ParseInt(strings.TrimSpace(record[colIdx["TIMESTAMP"]]), 10, 64)

		trips = append(trips, trip{
			TripID:    strings.TrimSpace(record[colIdx["TRIP_ID"]]),
			TaxiID:    strings.TrimSpace(record[colIdx["TAXI_ID"]]),
			Timestamp: ts,
			Polyline:  polyline,
		})

		if len(trips)%500 == 0 {
			log.Printf("  Parsed %d valid trips...", len(trips))
		}
	}
	return trips, nil
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
