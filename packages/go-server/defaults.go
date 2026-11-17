package savvagentflags

import (
	"log/slog"
	"os"
	"strconv"
	"strings"
)

// SetDefaultFunc sets the default for flagKey from value, which is called once, now. When value
// reports ok == false, any earlier default (or the built-in false) stays in place. It is for a
// default that comes from somewhere other than a constant; the result is fixed when the Config
// is built, not re-read per lookup.
//
// Defaults is allocated if it is nil. Like any write to Defaults, SetDefaultFunc changes the
// map a copied Config shares.
func (c *Config) SetDefaultFunc(flagKey string, value func() (enabled, ok bool)) {
	enabled, ok := value()
	if !ok {
		return
	}
	if c.Defaults == nil {
		c.Defaults = make(map[string]bool)
	}
	c.Defaults[flagKey] = enabled
}

// SetDefaultFromEnv sets the default for flagKey from the environment variable envVar, read
// once, now. It is for a service moving from env-var flags: "when Savvagent Flags cannot be
// reached, use what the variable says".
//
// Accepted values, ignoring case and surrounding whitespace, are 1, true, yes, on and 0, false,
// no, off. An unset variable is ignored silently (in production it is the normal case); one that
// is empty or says anything else is ignored with a slog warning that names the variable but not
// its value. Either way any earlier default, or the built-in false, stays in place.
//
//	var config savvagentflags.Config
//	config.APIKey = os.Getenv("SAVVAGENT_FLAGS_API_KEY")
//	config.SetDefaultFromEnv("new-checkout", "NEW_CHECKOUT_ENABLED")
func (c *Config) SetDefaultFromEnv(flagKey, envVar string) {
	c.SetDefaultFunc(flagKey, func() (bool, bool) {
		raw, set := os.LookupEnv(envVar)
		if !set {
			return false, false
		}
		enabled, ok := parseBool(raw)
		if !ok {
			slog.Warn("Savvagent Flags: environment variable " + strconv.Quote(envVar) + " is not a boolean; ignoring it")
		}
		return enabled, ok
	})
}

// parseBool accepts 1/true/yes/on and 0/false/no/off, ignoring case and surrounding whitespace.
func parseBool(raw string) (enabled, ok bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true, true
	case "0", "false", "no", "off":
		return false, true
	}
	return false, false
}
