package com.savvagent.flags.sdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.Test;

/**
 * This SDK sends no telemetry (docs/SDK-DEVELOPER-GUIDE.md, Cross-SDK behaviour): there is no
 * trackError, and telemetry, on by default in the builder, has no effect. These tests pin that
 * absence, so adding telemetry is a deliberate change to the matrix.
 */
class TelemetryAbsenceTest {

    @Test
    void flagClientHasNoTrackError() {
        boolean found = Arrays.stream(FlagClient.class.getMethods())
                .map(Method::getName)
                .anyMatch(name -> name.equalsIgnoreCase("trackError"));
        assertFalse(found, "FlagClient has trackError; update the cross-SDK behaviour matrix");
    }

    @Test
    void telemetryOnByDefaultSendsNothing() throws Exception {
        MockWebServer server = new MockWebServer();
        server.start();
        try {
            server.enqueue(new MockResponse()
                    .setHeader("Content-Type", "application/json")
                    .setBody("{\"enabled\":true}"));
            FlagClientConfig config = FlagClientConfig.builder("sdk_test")
                    .baseUrl(server.url("/").toString().replaceAll("/$", ""))
                    .enableRealtime(false)
                    .onError(e -> { })
                    .build();
            try (FlagClient client = new FlagClient(config)) {
                client.isEnabled("checkout", null);
                client.isEnabled("checkout", null); // cached
                client.isEnabled("a/b", null); // invalid key, no request
            }

            List<String> paths = new ArrayList<>();
            RecordedRequest request;
            while ((request = server.takeRequest(200, TimeUnit.MILLISECONDS)) != null) {
                paths.add(request.getPath());
            }
            assertEquals(List.of("/api/flags/checkout/evaluate"), paths);
        } finally {
            server.shutdown();
        }
    }
}
