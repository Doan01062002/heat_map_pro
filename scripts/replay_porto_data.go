// Package main — Porto Taxi Data Replayer
//
// Reads train.csv.zip (Porto taxi trajectory dataset), extracts GPS polylines,
// and replays them as JSON GPSBatch messages via WebSocket to the heatmap backend.
//
// This replaces the browser-based simulator with REAL taxi trajectory data,
// enabling realistic testing of the deviation detection pipeline.
//
// Usage:
//
//	go run scripts/replay_porto_data.go \
//	  -file train.csv.zip \
//	  -ws ws://localhost:8080/ws/driver \
//	  -drivers 200 \
//	  -speed 5
package main

import (
	"archive/zip"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

// GPSPoint matches the backend's expected JSON format.
type GPSPoint struct {
	DriverID  string  `json:"driver_id"`
	TripID    string  `json:"trip_id"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Timestamp int64   `json:"timestamp"`
	Heading   float32 `json:"heading"`
	Speed     float32 `json:"speed"`
}

// GPSBatch is sent to the backend every tick.
type GPSBatch struct {
	Points []GPSPoint `json:"points"`
}

// Trip represents a parsed taxi trajectory.
type Trip struct {
	TripID    string
	TaxiID    string
	Timestamp int64
	Polyline  [][2]float64 // [lng, lat] pairs
}

func main() {
	// --- Flags ---
	zipFile := flag.String("file", "train.csv.zip", "Path to train.csv.zip")
	wsURL := flag.String("ws", "ws://localhost:8080/ws/driver", "WebSocket endpoint")
	maxDrivers := flag.Int("drivers", 200, "Number of concurrent drivers to simulate")
	speedMultiplier := flag.Float64("speed", 5.0, "Replay speed multiplier (5 = 5x faster)")
	batchIntervalMs := flag.Int("batch-ms", 3000, "Batch send interval in milliseconds")
	deviationPct := flag.Float64("deviation", 20, "Percentage of drivers that deviate (0-100)")
	flag.Parse()

	log.Printf("=== Porto Taxi Data Replayer ===")
	log.Printf("File:       %s", *zipFile)
	log.Printf("WebSocket:  %s", *wsURL)
	log.Printf("Drivers:    %d", *maxDrivers)
	log.Printf("Speed:      %.1fx", *speedMultiplier)
	log.Printf("Deviation:  %.0f%%", *deviationPct)

	// --- Load trips from ZIP ---
	trips, err := loadTripsFromZip(*zipFile, *maxDrivers*3) // Load 3x to have enough variety
	if err != nil {
		log.Fatalf("Failed to load trips: %v", err)
	}
	log.Printf("Loaded %d trips with valid polylines", len(trips))

	if len(trips) == 0 {
		log.Fatal("No valid trips found in dataset")
	}

	// --- Connect WebSocket ---
	u, err := url.Parse(*wsURL)
	if err != nil {
		log.Fatalf("Invalid WebSocket URL: %v", err)
	}

	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		log.Fatalf("WebSocket connect failed: %v", err)
	}
	defer conn.Close()
	log.Printf("Connected to %s", *wsURL)

	// --- Setup drivers ---
	type DriverState struct {
		trip         Trip
		pointIndex   int
		isDeviating  bool
		deviationLat float64
		deviationLng float64
	}

	drivers := make([]DriverState, *maxDrivers)
	for i := 0; i < *maxDrivers; i++ {
		trip := trips[i%len(trips)]
		isDeviate := rand.Float64()*100 < *deviationPct
		drivers[i] = DriverState{
			trip:         trip,
			pointIndex:   0,
			isDeviating:  isDeviate,
			deviationLat: (rand.Float64() - 0.5) * 0.008, // ~400-800m
			deviationLng: (rand.Float64() - 0.5) * 0.008,
		}
	}

	// --- Replay loop ---
	ticker := time.NewTicker(time.Duration(*batchIntervalMs) * time.Millisecond)
	defer ticker.Stop()

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	var totalPointsSent uint64
	var totalBatches uint64
	var wsMu sync.Mutex

	// Stats ticker
	statsTicker := time.NewTicker(10 * time.Second)
	defer statsTicker.Stop()

	log.Printf("Starting replay... (Ctrl+C to stop)")

	for {
		select {
		case <-sigCh:
			log.Printf("Shutting down. Sent %d points in %d batches",
				atomic.LoadUint64(&totalPointsSent), atomic.LoadUint64(&totalBatches))
			return

		case <-statsTicker.C:
			log.Printf("[Stats] Points: %d | Batches: %d | Active drivers: %d",
				atomic.LoadUint64(&totalPointsSent),
				atomic.LoadUint64(&totalBatches),
				*maxDrivers,
			)

		case <-ticker.C:
			// Generate batch from all drivers
			points := make([]GPSPoint, 0, *maxDrivers)
			pointsPerStep := int(*speedMultiplier)
			if pointsPerStep < 1 {
				pointsPerStep = 1
			}

			for i := range drivers {
				d := &drivers[i]
				poly := d.trip.Polyline

				if d.pointIndex >= len(poly) {
					// Trip finished — assign a new random trip
					newTrip := trips[rand.Intn(len(trips))]
					d.trip = newTrip
					d.pointIndex = 0
				}

				// Current position
				idx := d.pointIndex
				lng := poly[idx][0]
				lat := poly[idx][1]

				// Apply deviation offset
				if d.isDeviating {
					lat += d.deviationLat
					lng += d.deviationLng
				}

				// Calculate heading
				var heading float32
				if idx+1 < len(poly) {
					dLat := poly[idx+1][1] - poly[idx][1]
					dLng := poly[idx+1][0] - poly[idx][0]
					heading = float32(bearing(dLat, dLng))
				}

				points = append(points, GPSPoint{
					DriverID:  fmt.Sprintf("taxi-%s", d.trip.TaxiID),
					TripID:    d.trip.TripID,
					Latitude:  lat,
					Longitude: lng,
					Timestamp: time.Now().UnixMilli(),
					Heading:   heading,
					Speed:     float32(20 + rand.Intn(40)), // 20-60 km/h
				})

				// Advance position
				d.pointIndex += pointsPerStep
			}

			if len(points) == 0 {
				continue
			}

			batch := GPSBatch{Points: points}
			data, err := json.Marshal(batch)
			if err != nil {
				log.Printf("Marshal error: %v", err)
				continue
			}

			wsMu.Lock()
			err = conn.WriteMessage(websocket.TextMessage, data)
			wsMu.Unlock()

			if err != nil {
				log.Printf("WebSocket write error: %v", err)
				return
			}

			atomic.AddUint64(&totalPointsSent, uint64(len(points)))
			atomic.AddUint64(&totalBatches, 1)
		}
	}
}

// loadTripsFromZip reads the first N valid trips from train.csv.zip.
func loadTripsFromZip(zipPath string, maxTrips int) ([]Trip, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}
	defer zr.Close()

	if len(zr.File) == 0 {
		return nil, fmt.Errorf("zip is empty")
	}

	f, err := zr.File[0].Open()
	if err != nil {
		return nil, fmt.Errorf("open csv entry: %w", err)
	}
	defer f.Close()

	reader := csv.NewReader(f)
	reader.LazyQuotes = true

	// Read header
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("read header: %w", err)
	}

	// Find column indices
	colIdx := make(map[string]int)
	for i, h := range header {
		colIdx[strings.TrimSpace(h)] = i
	}

	tripIDCol, ok1 := colIdx["TRIP_ID"]
	taxiIDCol, ok2 := colIdx["TAXI_ID"]
	tsCol, ok3 := colIdx["TIMESTAMP"]
	polyCol, ok4 := colIdx["POLYLINE"]
	missingCol, ok5 := colIdx["MISSING_DATA"]

	if !ok1 || !ok2 || !ok3 || !ok4 {
		return nil, fmt.Errorf("missing required columns (need TRIP_ID, TAXI_ID, TIMESTAMP, POLYLINE)")
	}

	var trips []Trip
	lineNum := 0

	for {
		if len(trips) >= maxTrips {
			break
		}

		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			lineNum++
			continue // Skip malformed rows
		}
		lineNum++

		// Skip trips with missing data
		if ok5 && strings.TrimSpace(record[missingCol]) == "True" {
			continue
		}

		// Parse polyline JSON
		polyStr := record[polyCol]
		if polyStr == "[]" || polyStr == "" {
			continue
		}

		var polyline [][2]float64
		if err := json.Unmarshal([]byte(polyStr), &polyline); err != nil {
			continue
		}

		// Skip very short trips (< 5 points ≈ < 75 seconds)
		if len(polyline) < 5 {
			continue
		}

		// Parse timestamp
		ts, _ := strconv.ParseInt(strings.TrimSpace(record[tsCol]), 10, 64)

		trips = append(trips, Trip{
			TripID:    strings.TrimSpace(record[tripIDCol]),
			TaxiID:    strings.TrimSpace(record[taxiIDCol]),
			Timestamp: ts,
			Polyline:  polyline,
		})

		// Progress log every 10k lines
		if lineNum%50000 == 0 {
			log.Printf("  Parsed %d lines, found %d valid trips...", lineNum, len(trips))
		}
	}

	return trips, nil
}

// bearing calculates approximate heading in degrees from delta lat/lng.
func bearing(dLat, dLng float64) float64 {
	// Simplified — proper bearing would use atan2 with radians
	deg := 0.0
	if dLng > 0 && dLat > 0 {
		deg = 45
	} else if dLng > 0 && dLat < 0 {
		deg = 135
	} else if dLng < 0 && dLat < 0 {
		deg = 225
	} else if dLng < 0 && dLat > 0 {
		deg = 315
	} else if dLng > 0 {
		deg = 90
	} else if dLng < 0 {
		deg = 270
	} else if dLat > 0 {
		deg = 0
	} else {
		deg = 180
	}
	return deg
}
