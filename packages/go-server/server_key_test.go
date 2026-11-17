package savvagentflags

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// syncBuffer is a bytes.Buffer safe for the concurrent writes a slog handler may make.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// captureSlog sends the default slog logger's output to a buffer for the rest of the test.
func captureSlog(t *testing.T) *syncBuffer {
	t.Helper()
	buf := &syncBuffer{}
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return buf
}

func TestServerKeyBuildsAClient(t *testing.T) {
	client, err := NewClient(Config{APIKey: "srv_test_key"})
	if err != nil {
		t.Fatalf("NewClient with a srv_ key: %v", err)
	}
	defer client.Close()
	if client.config.APIKey != "srv_test_key" {
		t.Errorf("APIKey = %q", client.config.APIKey)
	}
}

func TestServerKeyIsSentAsBearer(t *testing.T) {
	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Write([]byte(`{"enabled": true}`))
	}))
	defer server.Close()

	client, err := NewClient(Config{APIKey: "srv_test_key", BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if !client.IsEnabled("flag", nil) {
		t.Error("IsEnabled = false, want true")
	}
	if gotAuth != "Bearer srv_test_key" {
		t.Errorf("Authorization = %q", gotAuth)
	}
}

func TestClientKeyStillBuildsAClient(t *testing.T) {
	client, err := NewClient(Config{APIKey: "sdk_test_key"})
	if err != nil {
		t.Fatalf("NewClient with an sdk_ key: %v", err)
	}
	client.Close()
}

func TestOtherKeysAreRejected(t *testing.T) {
	for _, key := range []string{"", "pk_test", "SDK_test", "srv", "sk_test"} {
		if _, err := NewClient(Config{APIKey: key}); err == nil {
			t.Errorf("NewClient(%q) succeeded, want an error", key)
		} else if !strings.Contains(err.Error(), "'sdk_' or 'srv_'") {
			t.Errorf("NewClient(%q) error = %v", key, err)
		}
	}
}

const plainHTTPWarning = "Savvagent Flags: the server key will be sent over http; use an https base_url"

func TestServerKeyOverPlainHTTPWarnsOnce(t *testing.T) {
	logs := captureSlog(t)
	client, err := NewClient(Config{APIKey: "srv_test_key", BaseURL: "http://flags.example.com/flags"})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	// Lookups must not repeat it.
	client.IsEnabledCached("flag", nil)

	if got := strings.Count(logs.String(), plainHTTPWarning); got != 1 {
		t.Errorf("warning logged %d times, want 1; logs:\n%s", got, logs.String())
	}
	if !strings.Contains(logs.String(), "level=WARN") {
		t.Errorf("warning not at WARN level; logs:\n%s", logs.String())
	}
}

func TestPlainHTTPWarningNamesTheScheme(t *testing.T) {
	logs := captureSlog(t)
	client, err := NewClient(Config{APIKey: "srv_test_key", BaseURL: "ws://flags.example.com"})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	want := "Savvagent Flags: the server key will be sent over ws; use an https base_url"
	if !strings.Contains(logs.String(), want) {
		t.Errorf("logs = %q, want %q", logs.String(), want)
	}
}

func TestNoPlainHTTPWarning(t *testing.T) {
	cases := []struct{ name, key, baseURL string }{
		{"https", "srv_test_key", "https://flags.example.com/flags"},
		{"default base URL", "srv_test_key", ""},
		{"localhost", "srv_test_key", "http://localhost:8080"},
		{"127.0.0.1", "srv_test_key", "http://127.0.0.1:8080/flags"},
		{"[::1]", "srv_test_key", "http://[::1]:8080"},
		{"client key over http", "sdk_test_key", "http://flags.example.com"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logs := captureSlog(t)
			client, err := NewClient(Config{APIKey: tc.key, BaseURL: tc.baseURL})
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			if strings.Contains(logs.String(), "server key will be sent over") {
				t.Errorf("unexpected warning: %s", logs.String())
			}
		})
	}
}
