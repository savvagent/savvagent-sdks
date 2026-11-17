package savvagentflags

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
)

// This SDK sends no telemetry (docs/SDK-DEVELOPER-GUIDE.md, Cross-SDK behaviour): there is
// no TrackError, and EnableTelemetry is accepted but has no effect. These tests pin that
// absence, so adding telemetry is a deliberate change to the matrix.

func TestFlagClientHasNoTrackError(t *testing.T) {
	if _, ok := reflect.TypeOf(&FlagClient{}).MethodByName("TrackError"); ok {
		t.Fatal("FlagClient has a TrackError method; update the cross-SDK behaviour matrix")
	}
}

func TestEnableTelemetrySendsNoTelemetry(t *testing.T) {
	var mu sync.Mutex
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		paths = append(paths, r.URL.Path)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"enabled":true}`))
	}))
	defer srv.Close()

	client, err := NewClient(Config{
		APIKey:          "sdk_test",
		BaseURL:         srv.URL,
		EnableTelemetry: true,
		OnError:         func(error) {},
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	client.IsEnabled("checkout", nil)
	client.IsEnabled("checkout", nil) // cached
	client.IsEnabled("a/b", nil)      // invalid key, no request
	if err := client.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if want := []string{"/api/flags/checkout/evaluate"}; !reflect.DeepEqual(paths, want) {
		t.Errorf("requests = %v, want only %v", paths, want)
	}
}
