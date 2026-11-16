# Savvagent Flags Go Server SDK

Official Go Server SDK for Savvagent Flags - AI-powered feature flags with automatic error detection.

## Features

- 🚀 **Fast Evaluation**: Thread-safe in-memory caching with configurable TTL
- 📊 **Telemetry**: Automatic tracking of flag evaluations
- 🤖 **AI Error Detection**: Correlate errors with flag changes
- 📦 **Type Safe**: Full Go type safety with comprehensive documentation
- 🌐 **Server-Optimized**: Built specifically for Go server environments
- ⚡ **High Performance**: Minimal allocations and optimized for concurrency

## Requirements

- Go 1.21 or higher

## Installation

The module is not published with a version tag yet. Pin a commit of savvagent/flags-sdks:

```bash
go get github.com/savvagent/flags-sdks/packages/go-server@<commit>
```

## Quick Start

```go
package main

import (
    "fmt"
    "log"

    savvagentflags "github.com/savvagent/flags-sdks/packages/go-server"
)

func main() {
    // Initialize the client
    config := savvagentflags.Config{
        APIKey:        "sdk_your_api_key_here",
        ApplicationID: "your-app-id",
    }

    client, err := savvagentflags.NewClient(config)
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Evaluate a flag
    ctx := &savvagentflags.Context{
        UserID:      "user-123",
        Environment: "production",
    }

    result, err := client.Evaluate("new-feature", ctx)
    if err != nil {
        log.Printf("Error: %v", err)
    }

    fmt.Printf("Feature enabled: %v\n", result.Value)

    // Or use the convenience method
    if client.IsEnabled("new-feature", ctx) {
        // New feature code
    }
}
```

## Configuration

```go
config := savvagentflags.Config{
    APIKey:          "sdk_your_api_key_here",
    ApplicationID:   "your-app-id",
    BaseURL:         "https://api.savvagent.com/flags", // optional
    EnableRealtime:  true,                         // default: false; true opens the update stream
    CacheTTL:        60 * time.Second,            // default: 60 seconds
    EnableTelemetry: true,                         // default: true
    Timeout:         5 * time.Second,             // default: 5 seconds
    Defaults: map[string]bool{
        "feature-a": false,
        "feature-b": true,
    },
    OnError: func(err error) {
        log.Printf("Savvagent Flags error: %v", err)
    },
}

client, err := savvagentflags.NewClient(config)
if err != nil {
    log.Fatal(err)
}
defer client.Close()
```

Evaluations are cached per flag and per evaluation context for `CacheTTL`, so two users never share a cached result. At most 10,000 contexts are cached per flag.

### Real-time updates

With `EnableRealtime: true` the client reads the server's flag-change stream in a background
goroutine and drops a changed flag's cached results as soon as the change arrives, so a kill switch
does not wait for `CacheTTL`. The default is off (a Go `bool` cannot default to true), so set it
for services that need fast changes. The stream never delays or fails a lookup; while it is down,
`CacheTTL` bounds how stale a result can be. It reconnects with exponential backoff (about 1 second
up to 30 seconds, 5 minutes if the key is rejected) and drops the whole cache on every connection,
since changes may have been missed. Call `Close` to stop it. `OnError` is called once per failed
connection attempt, possibly from the stream goroutine, so it must be safe for concurrent use.

## Usage Examples

### HTTP Handler

```go
package main

import (
    "net/http"
    savvagentflags "github.com/savvagent/flags-sdks/packages/go-server"
)

func main() {
    client, _ := savvagentflags.NewClient(savvagentflags.Config{
        APIKey: "sdk_your_key",
    })
    defer client.Close()

    http.HandleFunc("/api/data", func(w http.ResponseWriter, r *http.Request) {
        ctx := &savvagentflags.Context{
            UserID:    r.Header.Get("X-User-ID"),
            IPAddress: r.RemoteAddr,
            UserAgent: r.UserAgent(),
            Attributes: map[string]interface{}{
                "plan": "premium",
            },
        }

        if client.IsEnabled("new-algorithm", ctx) {
            // New algorithm
            w.Write([]byte("Using new algorithm"))
        } else {
            // Old algorithm
            w.Write([]byte("Using old algorithm"))
        }
    })

    http.ListenAndServe(":8080", nil)
}
```

### Gin Framework

```go
package main

import (
    "github.com/gin-gonic/gin"
    savvagentflags "github.com/savvagent/flags-sdks/packages/go-server"
)

func main() {
    client, _ := savvagentflags.NewClient(savvagentflags.Config{
        APIKey: "sdk_your_key",
    })
    defer client.Close()

    r := gin.Default()

    // Middleware for feature flags
    r.Use(func(c *gin.Context) {
        ctx := &savvagentflags.Context{
            UserID:    c.GetHeader("X-User-ID"),
            IPAddress: c.ClientIP(),
            UserAgent: c.Request.UserAgent(),
        }

        c.Set("flagContext", ctx)
        c.Next()
    })

    r.GET("/premium-feature", func(c *gin.Context) {
        ctx := c.MustGet("flagContext").(*savvagentflags.Context)

        if !client.IsEnabled("premium-access", ctx) {
            c.JSON(403, gin.H{"error": "Premium access required"})
            return
        }

        c.JSON(200, gin.H{"data": "premium content"})
    })

    r.Run(":8080")
}
```

### gRPC Interceptor

```go
package main

import (
    "context"

    "google.golang.org/grpc"
    savvagentflags "github.com/savvagent/flags-sdks/packages/go-server"
)

func FlagInterceptor(client *savvagentflags.FlagClient) grpc.UnaryServerInterceptor {
    return func(
        ctx context.Context,
        req interface{},
        info *grpc.UnaryServerInfo,
        handler grpc.UnaryHandler,
    ) (interface{}, error) {
        // Extract user context from gRPC metadata
        flagCtx := &savvagentflags.Context{
            UserID: extractUserID(ctx),
        }

        // Store in context
        ctx = context.WithValue(ctx, "flagContext", flagCtx)
        ctx = context.WithValue(ctx, "flagClient", client)

        return handler(ctx, req)
    }
}

// In your service implementation
type MyService struct {
    // ...
}

func (s *MyService) GetData(ctx context.Context, req *Request) (*Response, error) {
    client := ctx.Value("flagClient").(*savvagentflags.FlagClient)
    flagCtx := ctx.Value("flagContext").(*savvagentflags.Context)

    if client.IsEnabled("new-feature", flagCtx) {
        return newImplementation(req), nil
    }
    return oldImplementation(req), nil
}
```

### Context with Request Data

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := &savvagentflags.Context{
        UserID:      r.Header.Get("X-User-ID"),
        SessionID:   getSessionID(r),
        Environment: os.Getenv("ENVIRONMENT"),
        IPAddress:   r.RemoteAddr,
        UserAgent:   r.UserAgent(),
        Attributes: map[string]interface{}{
            "country":   getUserCountry(r),
            "plan":      getUserPlan(r),
            "beta_user": isBetaUser(r),
        },
    }

    result, err := client.Evaluate("premium-features", ctx)
    if err != nil {
        log.Printf("Error evaluating flag: %v", err)
    }

    if result.Value {
        // Premium features
    }
}
```

## API Reference

### Types

#### Config

Configuration for the FlagClient.

```go
type Config struct {
    APIKey          string
    ApplicationID   string
    BaseURL         string
    EnableRealtime  bool
    CacheTTL        time.Duration
    EnableTelemetry bool
    Defaults        map[string]bool
    OnError         func(error)
    Timeout         time.Duration
}
```

#### Context

Context for flag evaluation.

```go
type Context struct {
    UserID        string
    SessionID     string
    ApplicationID string
    Attributes    map[string]interface{}
    Environment   string
    IPAddress     string
    UserAgent     string
}
```

#### EvaluationResult

Result from flag evaluation.

```go
type EvaluationResult struct {
    Key      string
    Value    bool
    Reason   string    // "cached", "evaluated", "default", "error"
    Metadata *Metadata
}

// Metadata: the server sends only Version and Scope.
type Metadata struct {
    Version int64  // flag version that produced the result; 0 when the server sent none
    Scope   string // e.g. "application"; empty when the server sent none
    // FlagID, Description and Variant exist for compatibility; the server never sends them.
}
```

Version and Scope are also set on `cached` results.

### Methods

#### NewClient(config Config) (*FlagClient, error)

Creates a new FlagClient with the given configuration.

```go
client, err := savvagentflags.NewClient(config)
```

#### Evaluate(flagKey string, ctx *Context) (*EvaluationResult, error)

Evaluates a feature flag and returns detailed results.

```go
result, err := client.Evaluate("my-flag", ctx)
```

#### IsEnabled(flagKey string, ctx *Context) bool

Checks if a flag is enabled (convenience method).

```go
enabled := client.IsEnabled("my-flag", ctx)
```

#### InvalidateCache(flagKey string)

Invalidates the cache for a specific flag or all flags.

```go
client.InvalidateCache("my-flag") // Specific flag
client.InvalidateCache("")        // All flags
```

#### Close() error

Cleans up resources.

```go
client.Close()
```

## Best Practices

1. **Singleton Pattern**: Create one client instance and reuse it
2. **Defer Close**: Always defer `client.Close()` after creation
3. **Context**: Provide rich context for better targeting
4. **Defaults**: Set sensible defaults for all flags
5. **Error Handling**: Configure appropriate error handlers
6. **Goroutine-Safe**: The client is safe for concurrent use

## Error Handling

```go
result, err := client.Evaluate("my-flag", ctx)
if err != nil {
    log.Printf("Error evaluating flag: %v", err)
    // The result still contains the default value
}

// Use the result even if there was an error
if result.Value {
    // Feature enabled
}
```

## Performance

The SDK is optimized for high-performance server environments:

- Thread-safe concurrent access
- Efficient in-memory caching
- Minimal allocations
- Connection pooling
- Configurable timeouts

## License

MIT

## Support

- Documentation: https://github.com/savvagent/flags-sdks#readme
- Issues: https://github.com/savvagent/flags-sdks/issues
- Email: support@savvagent.com
