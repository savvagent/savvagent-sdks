# Savvagent Flags Java Server SDK

Official Java Server SDK for Savvagent Flags - AI-powered feature flags with automatic error detection.

## Features

- 🚀 **Fast Evaluation**: Thread-safe in-memory caching with configurable TTL
- 📊 **Telemetry**: Automatic tracking of flag evaluations
- 🤖 **AI Error Detection**: Correlate errors with flag changes
- 📦 **Type Safe**: Full Java type safety with comprehensive JavaDocs
- 🌐 **Server-Optimized**: Built specifically for Java server environments
- ⚡ **High Performance**: Async HTTP client with connection pooling

## Requirements

- Java 11 or higher
- Maven or Gradle

## Installation

### Maven

```xml
<dependency>
    <groupId>com.savvagent.flags</groupId>
    <artifactId>savvagent-flags-java-server-sdk</artifactId>
    <version>0.1.0</version>
</dependency>
```

### Gradle

```gradle
implementation 'com.savvagent.flags:savvagent-flags-java-server-sdk:0.1.0'
```

## Quick Start

```java
import com.savvagent.flags.sdk.*;

// Initialize the client
FlagClientConfig config = FlagClientConfig.builder("sdk_your_api_key_here")
    .applicationId("your-app-id")
    .build();

FlagClient client = new FlagClient(config);

// Evaluate a flag
FlagContext context = FlagContext.builder()
    .userId("user-123")
    .environment("production")
    .build();

FlagEvaluationResult result = client.evaluate("new-feature", context);
System.out.println("Feature enabled: " + result.getValue());

// Or use the convenience method
boolean isEnabled = client.isEnabled("new-feature", context);

// Clean up
client.close();
```

## Configuration

```java
FlagClientConfig config = FlagClientConfig.builder("sdk_your_api_key_here")
    .applicationId("your-app-id")
    .baseUrl("https://api.savvagent.com/flags") // optional
    .enableRealtime(true) // default: true; opens the update stream
    .cacheTtl(60000L) // default: 60 seconds; results are cached per flag and per context
    .enableTelemetry(true) // default: true
    .timeout(5000) // request timeout in ms, default: 5000
    .defaults(Map.of(
        "feature-a", false,
        "feature-b", true
    ))
    .onError(error -> {
        logger.error("Savvagent Flags error", error);
    })
    .build();

FlagClient client = new FlagClient(config);
```

### Real-time updates

Real-time updates are on by default. The client reads the server's flag-change stream on a daemon
thread and drops a changed flag's cached results as soon as the change arrives, so a kill switch
does not wait for `cacheTtl`. The stream never delays or fails a lookup; while it is down,
`cacheTtl` bounds how stale a result can be. It reconnects with exponential backoff (about 1 second
up to 30 seconds, 5 minutes if the key is rejected) and drops the whole cache on every connection,
since changes may have been missed. Turn it off with `.enableRealtime(false)`. Call `close()` to stop
it. `onError` is called once per failed connection attempt, possibly from the stream thread, so it
must be safe for concurrent use.

## Usage Examples

### Spring Boot Integration

```java
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Value;
import javax.annotation.PreDestroy;

@Configuration
public class SavvagentFlagsConfig {

    private FlagClient flagClient;

    @Bean
    public FlagClient flagClient(
        @Value("${savvagentFlags.api-key}") String apiKey,
        @Value("${savvagentFlags.app-id}") String appId
    ) {
        FlagClientConfig config = FlagClientConfig.builder(apiKey)
            .applicationId(appId)
            .build();

        this.flagClient = new FlagClient(config);
        return this.flagClient;
    }

    @PreDestroy
    public void cleanup() {
        if (flagClient != null) {
            flagClient.close();
        }
    }
}
```

### Service Layer

```java
import org.springframework.stereotype.Service;

@Service
public class FeatureService {

    private final FlagClient flagClient;

    public FeatureService(FlagClient flagClient) {
        this.flagClient = flagClient;
    }

    public boolean isFeatureEnabled(String flagKey, String userId) {
        FlagContext context = FlagContext.builder()
            .userId(userId)
            .environment(System.getenv("ENVIRONMENT"))
            .build();

        return flagClient.isEnabled(flagKey, context);
    }
}
```

### REST Controller

```java
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class DataController {

    private final FlagClient flagClient;

    public DataController(FlagClient flagClient) {
        this.flagClient = flagClient;
    }

    @GetMapping("/data")
    public ResponseEntity<?> getData(HttpServletRequest request) {
        FlagContext context = FlagContext.builder()
            .userId(request.getUserPrincipal().getName())
            .sessionId(request.getSession().getId())
            .ipAddress(request.getRemoteAddr())
            .userAgent(request.getHeader("User-Agent"))
            .attribute("plan", "premium")
            .build();

        boolean useNewAlgorithm = flagClient.isEnabled("new-algorithm", context);

        if (useNewAlgorithm) {
            return ResponseEntity.ok(newAlgorithm());
        } else {
            return ResponseEntity.ok(oldAlgorithm());
        }
    }
}
```

### Servlet Filter

```java
import javax.servlet.*;
import javax.servlet.http.HttpServletRequest;
import java.io.IOException;

public class FeatureFlagFilter implements Filter {

    private final FlagClient flagClient;
    private final String flagKey;

    public FeatureFlagFilter(FlagClient flagClient, String flagKey) {
        this.flagClient = flagClient;
        this.flagKey = flagKey;
    }

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest httpRequest = (HttpServletRequest) request;

        FlagContext context = FlagContext.builder()
            .userId(httpRequest.getUserPrincipal()?.getName())
            .sessionId(httpRequest.getSession().getId())
            .build();

        boolean enabled = flagClient.isEnabled(flagKey, context);
        request.setAttribute("featureEnabled", enabled);

        chain.doFilter(request, response);
    }
}
```

### Try-with-Resources

```java
try (FlagClient client = new FlagClient(config)) {
    boolean enabled = client.isEnabled("my-feature");

    if (enabled) {
        // New feature code
    } else {
        // Old code
    }
}
```

## API Reference

### FlagClient

#### Methods

##### evaluate(String flagKey, FlagContext context)

Evaluate a feature flag and return detailed results.

```java
FlagEvaluationResult result = client.evaluate("my-flag", context);
// Returns: FlagEvaluationResult with key, value, configuration, variation, reason, metadata

result.getMetadata().getVersion(); // Long: the flag version the server evaluated
result.getMetadata().getScope();   // String: the evaluation scope, e.g. "application"
```

`getVersion()` and `getScope()` are null when the server sent none or a malformed value.
`getFlagId()`, `getDescription()` and `getVariant()` are not sent by the savvagent-flags server and
stay null. A result with reason `cached` carries the same version and scope as the evaluation
it came from; a result with reason `error` has null metadata.

##### isEnabled(String flagKey, FlagContext context)

Check if a flag is enabled (returns boolean).

```java
boolean enabled = client.isEnabled("my-flag", context);
```

##### invalidateCache(String flagKey)

Manually invalidate cache for a flag or all flags.

```java
client.invalidateCache("my-flag"); // Specific flag
client.invalidateCache(null); // All flags
```

##### close()

Clean up resources (close HTTP client, clear cache).

```java
client.close();
```

### FlagContext

Context builder for flag evaluation:

```java
FlagContext context = FlagContext.builder()
    .userId("user-123")
    .sessionId("session-abc")
    .environment("production")
    .ipAddress("192.168.1.1")
    .userAgent("Mozilla/5.0...")
    .attribute("plan", "premium")
    .attributes(Map.of("key", "value"))
    .build();
```

## Best Practices

1. **Singleton Pattern**: Create one `FlagClient` instance and reuse it (e.g., as a Spring Bean)
2. **Resource Management**: Use try-with-resources or call `close()` on shutdown
3. **Context**: Provide rich context for better targeting
4. **Defaults**: Set sensible defaults for all flags
5. **Error Handling**: Configure appropriate error handlers

## Logging

The SDK uses SLF4J for logging. Configure your logging framework accordingly:

```xml
<!-- Logback example -->
<logger name="com.savvagent.flags.sdk" level="INFO"/>
```

## Build from Source

```bash
mvn clean install
```

## License

MIT

## Support

- Documentation: https://github.com/savvagent/flags-sdks#readme
- Issues: https://github.com/savvagent/flags-sdks/issues
- Email: support@savvagent.com
