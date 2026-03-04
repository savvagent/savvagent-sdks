# Savvagent Go Server SDK

Official Go Server SDK for Savvagent - AI-powered feature flags with automatic error detection.

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

```bash
go get github.com/savvagent/savvagent-go-server-sdk
```

## Quick Start

```go
package main

import (
    "fmt"
    "log"

    savvagent "github.com/savvagent/savvagent-go-server-sdk"
)

func main() {
    // Initialize the client
    config := savvagent.Config{
        APIKey:        "sdk_your_api_key_here",
        ApplicationID: "your-app-id",
    }

    client, err := savvagent.NewClient(config)
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Evaluate a flag
    ctx := &savvagent.Context{
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
config := savvagent.Config{
    APIKey:          "sdk_your_api_key_here",
    ApplicationID:   "your-app-id",
    BaseURL:         "https://flags-api.savvagent.com", // optional
    EnableRealtime:  true,                         // default: true
    CacheTTL:        60 * time.Second,            // default: 60 seconds
    EnableTelemetry: true,                         // default: true
    Timeout:         5 * time.Second,             // default: 5 seconds
    Defaults: map[string]bool{
        "feature-a": false,
        "feature-b": true,
    },
    OnError: func(err error) {
        log.Printf("Savvagent error: %v", err)
    },
}

client, err := savvagent.NewClient(config)
if err != nil {
    log.Fatal(err)
}
defer client.Close()
```

## Usage Examples

### HTTP Handler

```go
package main

import (
    "net/http"
    savvagent "github.com/savvagent/savvagent-go-server-sdk"
)

func main() {
    client, _ := savvagent.NewClient(savvagent.Config{
        APIKey: "sdk_your_key",
    })
    defer client.Close()

    http.HandleFunc("/api/data", func(w http.ResponseWriter, r *http.Request) {
        ctx := &savvagent.Context{
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
    savvagent "github.com/savvagent/savvagent-go-server-sdk"
)

func main() {
    client, _ := savvagent.NewClient(savvagent.Config{
        APIKey: "sdk_your_key",
    })
    defer client.Close()

    r := gin.Default()

    // Middleware for feature flags
    r.Use(func(c *gin.Context) {
        ctx := &savvagent.Context{
            UserID:    c.GetHeader("X-User-ID"),
            IPAddress: c.ClientIP(),
            UserAgent: c.Request.UserAgent(),
        }

        c.Set("flagContext", ctx)
        c.Next()
    })

    r.GET("/premium-feature", func(c *gin.Context) {
        ctx := c.MustGet("flagContext").(*savvagent.Context)

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
    savvagent "github.com/savvagent/savvagent-go-server-sdk"
)

func FlagInterceptor(client *savvagent.FlagClient) grpc.UnaryServerInterceptor {
    return func(
        ctx context.Context,
        req interface{},
        info *grpc.UnaryServerInfo,
        handler grpc.UnaryHandler,
    ) (interface{}, error) {
        // Extract user context from gRPC metadata
        flagCtx := &savvagent.Context{
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
    client := ctx.Value("flagClient").(*savvagent.FlagClient)
    flagCtx := ctx.Value("flagContext").(*savvagent.Context)

    if client.IsEnabled("new-feature", flagCtx) {
        return newImplementation(req), nil
    }
    return oldImplementation(req), nil
}
```

### Context with Request Data

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := &savvagent.Context{
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
```

### Methods

#### NewClient(config Config) (*FlagClient, error)

Creates a new FlagClient with the given configuration.

```go
client, err := savvagent.NewClient(config)
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

- Documentation: https://flags-docs.savvagent.com
- Issues: https://github.com/savvagent/savvagent-sdks/issues
- Email: support@savvagent.com
