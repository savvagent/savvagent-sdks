# Savvagent Java Server Example

Example Spring Boot application demonstrating how to use the Savvagent Java Server SDK.

## Features

- Spring Boot 3.2
- Java 17
- Maven build
- Savvagent Java Server SDK
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
   savvagent.api-url=http://localhost:8080
   savvagent.sdk-key=your-sdk-key-here
   savvagent.environment=development
   server.port=8081
   ```

2. **Build the project:**
   ```bash
   mvn clean package
   ```

3. **Run the application:**
   ```bash
   mvn spring-boot:run
   ```

4. The server will start on [http://localhost:8081](http://localhost:8081)

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
    private final SavvagentClient savvagent;

    @Autowired
    public FeatureController(SavvagentClient savvagent) {
        this.savvagent = savvagent;
    }

    @GetMapping("/features")
    public ResponseEntity<Map<String, Object>> getFeatures(
        @RequestParam String userId
    ) {
        boolean isEnabled = savvagent.isEnabled("new-feature",
            EvaluationContext.builder()
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
- [Savvagent Java SDK Documentation](../../packages/java-server/README.md)
- [SDK Integration Guide](../../docs/SDK-INTEGRATION.md)
