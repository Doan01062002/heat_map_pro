package persistence

import (
	"testing"
)

func TestHandleHistoryQuery_MissingParams(t *testing.T) {
	t.Skip("TODO: Implement with httptest — verify 400 when from/to are missing")
}

func TestHandleHistoryQuery_ValidParams(t *testing.T) {
	t.Skip("TODO: Implement with pgxmock for database mocking")
}

func TestHandleDeviationsQuery_WithDriverFilter(t *testing.T) {
	t.Skip("TODO: Implement with pgxmock — verify SQL includes driver_id filter")
}
