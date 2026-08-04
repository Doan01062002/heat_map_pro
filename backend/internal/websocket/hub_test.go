package websocket

import (
	"testing"
)

func TestHub_HandleWebSocket(t *testing.T) {
	t.Skip("TODO: Implement with httptest + gorilla websocket dialer to verify client registration")
}

func TestHub_Broadcast_RemovesDeadClients(t *testing.T) {
	t.Skip("TODO: Implement by creating a hub, adding a mock conn that returns write error, and verifying it's removed after broadcast")
}

func TestHub_ClientCount(t *testing.T) {
	t.Skip("TODO: Implement by connecting/disconnecting clients and verifying count")
}
