# Savvagent Flags Java Server Example

Example Spring Boot application demonstrating how to use the Savvagent Flags Java Server SDK.

## Features

- Spring Boot 3.2
- Java 17
- Maven build
- Savvagent Flags Java Server SDK
- RESTful API endpoints
- Feature-gated functionality
- In-memory caching

## Prerequisites

- Java 17 or higher
- Maven 3.6 or higher

## Setup

1. **Configure environment variables:**

   Create `application.properties` with your credentials:
   ```properties
   savvagentFlags.api-url=https://api.savvagent.com/flags
   savvagentFlags.sdk-key=sdk_your_key
   server.port=8081
   ```

2. **Install the SDK locally** (it is not published to a Maven repository):
   ```bash
   (cd ../../packages/java-server && mvn install -DskipTests)
   ```

3. **Build the project:**
   ```bash
   mvn clean package
   ```

4. **Run the application:**
   ```bash
   mvn spring-boot:run
   ```

5. The server will start on [http://localhost:8081](http://localhost:8081)

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

```java
@RestController
@RequestMapping("/api")
public class FeatureController {
    private final FlagClient savvagentFlags;

    @Autowired
    public FeatureController(FlagClient savvagentFlags) {
        this.savvagentFlags = savvagentFlags;
    }

    @GetMapping("/features")
    public ResponseEntity<Map<String, Object>> getFeatures(
        @RequestParam String userId
    ) {
        boolean isEnabled = savvagentFlags.isEnabled("new-feature",
            FlagContext.builder()
                .userId(userId)
                .attribute("plan", "pro")
                .build()
        );

        return ResponseEntity.ok(Map.of(
            "userId", userId,
            "newFeature", isEnabled
        ));
    }
}
```

## Learn More

- [Spring Boot Documentation](https://spring.io/projects/spring-boot)
- [Savvagent Flags Java SDK Documentation](../../packages/java-server/README.md)
- [SDK Integration Guide](../../docs/SDK-INTEGRATION.md)
