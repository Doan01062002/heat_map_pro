package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// Driver represents a registered driver user in the system.
type Driver struct {
	ID           int64     `json:"id"`
	DriverID     string    `json:"driver_id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"` // Never expose hash in JSON
	FullName     string    `json:"full_name"`
	Phone        string    `json:"phone"`
	LicensePlate string    `json:"license_plate"`
	VehicleType  string    `json:"vehicle_type"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// RegisterInput holds user registration parameters.
type RegisterInput struct {
	Email        string `json:"email"`
	Password     string `json:"password"`
	FullName     string `json:"full_name"`
	Phone        string `json:"phone"`
	LicensePlate string `json:"license_plate"`
	VehicleType  string `json:"vehicle_type"`
}

// LoginInput holds user login credentials.
type LoginInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// AuthResponse holds the response payload for successful registration/login.
type AuthResponse struct {
	Token  string `json:"token"`
	Driver Driver `json:"driver"`
}

// Repository manages DB operations for authentication.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository creates a new Auth Repository.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// HashPassword hashes a raw password using bcrypt.
func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}
	return string(bytes), nil
}

// CheckPasswordHash compares a raw password with a bcrypt hash.
func CheckPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// GenerateToken generates a simple secure token for driver session auth.
func GenerateToken() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// GenerateDriverID creates a unique driver identifier e.g. DRV-8F3A2B
func GenerateDriverID() string {
	b := make([]byte, 4)
	rand.Read(b)
	return fmt.Sprintf("DRV-%s", strings.ToUpper(hex.EncodeToString(b)))
}

// CreateDriver registers a new driver in PostgreSQL.
func (r *Repository) CreateDriver(ctx context.Context, input RegisterInput) (*Driver, error) {
	hash, err := HashPassword(input.Password)
	if err != nil {
		return nil, err
	}

	driverID := GenerateDriverID()
	vehicleType := input.VehicleType
	if vehicleType == "" {
		vehicleType = "taxi"
	}

	query := `
		INSERT INTO drivers (driver_id, email, password_hash, full_name, phone, license_plate, vehicle_type, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW(), NOW())
		RETURNING id, driver_id, email, full_name, phone, license_plate, vehicle_type, status, created_at, updated_at
	`

	var d Driver
	err = r.pool.QueryRow(ctx, query,
		driverID, strings.ToLower(input.Email), hash, input.FullName, input.Phone, input.LicensePlate, vehicleType,
	).Scan(
		&d.ID, &d.DriverID, &d.Email, &d.FullName, &d.Phone, &d.LicensePlate, &d.VehicleType, &d.Status, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("CreateDriver: %w", err)
	}

	return &d, nil
}

// GetDriverByEmail finds a driver by email address.
func (r *Repository) GetDriverByEmail(ctx context.Context, email string) (*Driver, error) {
	query := `
		SELECT id, driver_id, email, password_hash, full_name, phone, license_plate, vehicle_type, status, created_at, updated_at
		FROM drivers
		WHERE email = $1
	`

	var d Driver
	err := r.pool.QueryRow(ctx, query, strings.ToLower(email)).Scan(
		&d.ID, &d.DriverID, &d.Email, &d.PasswordHash, &d.FullName, &d.Phone, &d.LicensePlate, &d.VehicleType, &d.Status, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("GetDriverByEmail: %w", err)
	}

	return &d, nil
}

// GetDriverByID finds a driver by driver_id string.
func (r *Repository) GetDriverByID(ctx context.Context, driverID string) (*Driver, error) {
	query := `
		SELECT id, driver_id, email, full_name, phone, license_plate, vehicle_type, status, created_at, updated_at
		FROM drivers
		WHERE driver_id = $1
	`

	var d Driver
	err := r.pool.QueryRow(ctx, query, driverID).Scan(
		&d.ID, &d.DriverID, &d.Email, &d.FullName, &d.Phone, &d.LicensePlate, &d.VehicleType, &d.Status, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("GetDriverByID: %w", err)
	}

	return &d, nil
}
