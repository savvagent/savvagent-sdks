# Savvagent Go Server Example

Example Go application demonstrating how to use the Savvagent Go Server SDK with Gin framework.

## Features

- Go 1.21+
- Gin web framework
- Savvagent Go Server SDK
- RESTful API endpoints
- Feature-gated functionality
- Goroutine-safe concurrent access
- In-memory caching

## Prerequisites

- Go 1.21 or higher

## Setup

1. **Install dependencies:**
   ```bash
   go mod download
   ```

2. **Configure environment variables:**
   ```bash
   export SAVVAGENT_API_URL=http://localhost:8080
   export SAVVAGENT_SDK_KEY=your-sdk-key-here
   export PORT=8082
   ```

3. **Run the server:**
   ```bash
   go run main.go
   ```

4. The server will start on [http://localhost:8082](http://localhost:8082)

## API Endpoints

### Health Check

```bash
GET /health
```

Returns server status.

### Get User Features

```bash
GET /api/features?userId=user-123
```

Returns all feature flags for a user.

Example response:
```json
{
  "userId": "user-123",
  "features": {
    "newUI": true,
    "betaFeatures": false,
    "advancedAnalytics": true
  }
}
```

### Process Data (Feature-Gated)

```bash
POST /api/data
Content-Type: application/json

{
  "userId": "user-123",
  "data": "example data"
}
```

Uses the `advanced-processing` flag to determine processing method.

## Usage Example

```go
package main

import (
    "github.com/gin-gonic/gin"
    "github.com/savvagent/savvagent-go-server-sdk/pkg/savvagent"
)

func main() {
    client := savvagent.NewClient(savvagent.Config{
        APIURL:      os.Getenv("SAVVAGENT_API_URL"),
        SDKKey:      os.Getenv("SAVVAGENT_SDK_KEY"),
        Environment: "development",
    })
    defer client.Close()

    r := gin.Default()

    r.GET("/api/features", func(c *gin.Context) {
        userId := c.Query("userId")

        isEnabled, err := client.IsEnabled("new-feature", savvagent.EvaluationContext{
            UserID: userId,
            Attributes: map[string]interface{}{
                "plan": "pro",
            },
        })

        if err != nil {
            c.JSON(500, gin.H{"error": err.Error()})
            return
        }

        c.JSON(200, gin.H{
            "userId":     userId,
            "newFeature": isEnabled,
        })
    })

    r.Run(":8082")
}
```

## Learn More

- [Go Documentation](https://go.dev/doc/)
- [Gin Framework](https://gin-gonic.com/)
- [Savvagent Go SDK Documentation](../../packages/go-server/README.md)
- [SDK Integration Guide](../../docs/SDK-INTEGRATION.md)
