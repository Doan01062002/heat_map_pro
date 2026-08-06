package auth

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
)

// Handler handles HTTP requests for driver authentication.
type Handler struct {
	repo *Repository
}

// NewHandler creates a new Auth Handler.
func NewHandler(repo *Repository) *Handler {
	return &Handler{repo: repo}
}

// Register handles POST /api/auth/register
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var input RegisterInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, `{"error":"invalid JSON body"}`, http.StatusBadRequest)
		return
	}

	// Basic validation
	input.Email = strings.TrimSpace(input.Email)
	input.Password = strings.TrimSpace(input.Password)
	input.FullName = strings.TrimSpace(input.FullName)

	if input.Email == "" || input.Password == "" || input.FullName == "" {
		http.Error(w, `{"error":"email, password, and full_name are required"}`, http.StatusBadRequest)
		return
	}

	if len(input.Password) < 6 {
		http.Error(w, `{"error":"password must be at least 6 characters"}`, http.StatusBadRequest)
		return
	}

	// Check existing driver email
	existing, err := h.repo.GetDriverByEmail(r.Context(), input.Email)
	if err != nil {
		slog.Error("failed to query driver by email", "error", err)
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
		return
	}
	if existing != nil {
		http.Error(w, `{"error":"Email đã được sử dụng. Vui lòng chọn email khác!"}`, http.StatusConflict)
		return
	}

	// Create new driver
	driver, err := h.repo.CreateDriver(r.Context(), input)
	if err != nil {
		slog.Error("failed to create driver", "error", err)
		http.Error(w, `{"error":"failed to create driver account"}`, http.StatusInternalServerError)
		return
	}

	token := GenerateToken()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(AuthResponse{
		Token:  token,
		Driver: *driver,
	})
}

// Login handles POST /api/auth/login
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var input LoginInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, `{"error":"invalid JSON body"}`, http.StatusBadRequest)
		return
	}

	input.Email = strings.TrimSpace(input.Email)
	input.Password = strings.TrimSpace(input.Password)

	if input.Email == "" || input.Password == "" {
		http.Error(w, `{"error":"email and password are required"}`, http.StatusBadRequest)
		return
	}

	driver, err := h.repo.GetDriverByEmail(r.Context(), input.Email)
	if err != nil {
		slog.Error("login query failed", "error", err)
		http.Error(w, `{"error":"database error"}`, http.StatusInternalServerError)
		return
	}

	if driver == nil || !CheckPasswordHash(input.Password, driver.PasswordHash) {
		http.Error(w, `{"error":"Email hoặc mật khẩu không chính xác!"}`, http.StatusUnauthorized)
		return
	}

	token := GenerateToken()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(AuthResponse{
		Token:  token,
		Driver: *driver,
	})
}

// Me handles GET /api/auth/me (returns driver profile using Authorization header or driver_id query)
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	driverID := r.URL.Query().Get("driver_id")
	authHeader := r.Header.Get("Authorization")
	if driverID == "" && strings.HasPrefix(authHeader, "Bearer ") {
		driverID = strings.TrimPrefix(authHeader, "Bearer ")
	}

	if driverID == "" {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	driver, err := h.repo.GetDriverByID(r.Context(), driverID)
	if err != nil || driver == nil {
		http.Error(w, `{"error":"driver not found"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(driver)
}

// WriteJSONError helper for formatted JSON errors
func WriteJSONError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	fmt.Fprintf(w, `{"error":"%s"}`, msg)
}
