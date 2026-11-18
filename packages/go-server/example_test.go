package savvagentflags_test

import (
	"fmt"
	"os"

	savvagentflags "github.com/savvagent/flags-sdks/packages/go-server"
)

func ExampleNewStaticClient() {
	client := savvagentflags.NewStaticClient(map[string]bool{"new-checkout": true})
	defer client.Close()

	fmt.Println(client.IsEnabled("new-checkout", nil))
	fmt.Println(client.IsEnabled("anything-else", nil))
	// Output:
	// true
	// false
}

func ExampleConfig_SetDefaultFromEnv() {
	os.Setenv("EXAMPLE_NEW_CHECKOUT_ENABLED", "true")
	defer os.Unsetenv("EXAMPLE_NEW_CHECKOUT_ENABLED")

	config := savvagentflags.Config{APIKey: "srv_example_key"}
	config.SetDefaultFromEnv("new-checkout", "EXAMPLE_NEW_CHECKOUT_ENABLED")

	fmt.Println(config.Defaults["new-checkout"])
	// Output: true
}

func ExampleFlagClient_IsEnabledCached() {
	client, err := savvagentflags.NewClient(savvagentflags.Config{
		APIKey:   "srv_example_key",
		Defaults: map[string]bool{"new-banner": true},
	})
	if err != nil {
		panic(err)
	}
	defer client.Close()

	// Nothing is cached yet, so this is the configured default, and no request is made.
	fmt.Println(client.IsEnabledCached("new-banner", nil))
	// Output: true
}
