package savvagentflags

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDefaultBaseURL(t *testing.T) {
	client, err := NewClient(Config{APIKey: "sdk_test_key"})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := client.config.BaseURL, "https://api.savvagent.com/flags"; got != want {
		t.Errorf("BaseURL = %q, want %q", got, want)
	}
}

func TestBaseURLTrailingSlashesAreRemoved(t *testing.T) {
	client, err := NewClient(Config{APIKey: "sdk_test_key", BaseURL: "https://flags.example.com/flags//"})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := client.config.BaseURL, "https://flags.example.com/flags"; got != want {
		t.Errorf("BaseURL = %q, want %q", got, want)
	}
}

func TestEvaluateUsesCanonicalRouteAndReadsEnabled(t *testing.T) {
	var gotPath, gotMethod string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotMethod = r.URL.Path, r.Method
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"key":"new-checkout","enabled":true,"scope":"application","variation":null,"configuration":null,"timestamp":1731550000,"version":3,"context":{}}`))
	}))
	defer server.Close()

	client, err := NewClient(Config{APIKey: "sdk_test_key", BaseURL: server.URL + "/flags//"})
	if err != nil {
		t.Fatal(err)
	}

	if !client.IsEnabled("new-checkout", nil) {
		t.Error("IsEnabled = false, want true")
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %s, want POST", gotMethod)
	}
	if want := "/flags/api/flags/new-checkout/evaluate"; gotPath != want {
		t.Errorf("path = %q, want %q", gotPath, want)
	}
}
