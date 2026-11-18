package com.savvagent.flags.sdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Server keys (#43) and the plain-HTTP warning (#44): {@code srv_} keys are accepted alongside
 * {@code sdk_} keys, and a server key bound for a non-https, non-loopback base URL logs one
 * warning, worded as the Rust SDK words it.
 */
class ServerKeyTest {

    @BeforeEach
    void clearLogs() {
        CapturingLogs.clear();
    }

    private static List<String> plainHttpWarnings() {
        List<String> result = new java.util.ArrayList<>();
        for (String warning : CapturingLogs.warnings()) {
            if (warning.contains("server key will be sent over")) {
                result.add(warning);
            }
        }
        return result;
    }

    private static FlagClient client(String apiKey, String baseUrl) {
        return new FlagClient(FlagClientConfig.builder(apiKey)
                .baseUrl(baseUrl)
                .enableRealtime(false)
                .build());
    }

    @Test
    void serverKeyBuildsAClient() {
        FlagClientConfig config = FlagClientConfig.builder("srv_test_key").enableRealtime(false).build();
        assertEquals("srv_test_key", config.getApiKey());
        try (FlagClient client = new FlagClient(config)) {
            assertTrue(client != null);
        }
    }

    @Test
    void clientKeyStillBuildsAClient() {
        assertEquals("sdk_test_key", FlagClientConfig.builder("sdk_test_key").build().getApiKey());
    }

    @Test
    void otherKeysAreRejected() {
        for (String key : Arrays.asList(null, "", "srv", "sdk", "pk_live_1", "SRV_x", "Sdk_x", " srv_x")) {
            IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                    () -> FlagClientConfig.builder(key).build(), "key " + key);
            assertTrue(e.getMessage().contains("'sdk_'") && e.getMessage().contains("'srv_'"),
                    e.getMessage());
        }
    }

    @Test
    void serverKeyIsSentAsTheBearerToken() throws Exception {
        MockWebServer server = new MockWebServer();
        server.enqueue(new MockResponse().setHeader("Content-Type", "application/json")
                .setBody("{\"enabled\":true}"));
        server.start();
        try (FlagClient client = client("srv_secret", server.url("/").toString())) {
            assertTrue(client.isEnabled("checkout"));
            RecordedRequest request = server.takeRequest();
            assertEquals("Bearer srv_secret", request.getHeader("Authorization"));
            assertEquals("/api/flags/checkout/evaluate", request.getPath());
        } finally {
            server.shutdown();
        }
    }

    @Test
    void serverKeyOverPlainHttpWarnsOnce() {
        try (FlagClient client = client("srv_secret", "http://flags.example.com/flags")) {
            client.isEnabledCached("checkout");
        }
        assertEquals(Collections.singletonList(
                "Savvagent Flags: the server key will be sent over http; use an https base_url"),
                plainHttpWarnings());
    }

    @Test
    void warningNamesTheScheme() {
        assertEquals("Savvagent Flags: the server key will be sent over ws; use an https base_url",
                FlagClient.plainHttpWarning("srv_secret", "ws://flags.example.com"));
        assertEquals("Savvagent Flags: the server key will be sent over http; use an https base_url",
                FlagClient.plainHttpWarning("srv_secret", "HTTP://flags.example.com"));
    }

    @Test
    void noWarningForHttps() {
        client("srv_secret", "https://flags.example.com/flags").close();
        client("srv_secret", "HTTPS://flags.example.com/flags").close();
        assertEquals(Collections.emptyList(), plainHttpWarnings());
    }

    @Test
    void noWarningForLoopbackHosts() {
        for (String url : Arrays.asList("http://localhost:8080", "http://LOCALHOST/flags",
                "http://127.0.0.1:3000/flags", "http://[::1]:8080")) {
            client("srv_secret", url).close();
        }
        assertEquals(Collections.emptyList(), plainHttpWarnings());
    }

    @Test
    void noWarningForAClientKey() {
        client("sdk_public", "http://flags.example.com/flags").close();
        assertEquals(Collections.emptyList(), plainHttpWarnings());
    }

    @Test
    void noWarningForTheDefaultBaseUrl() {
        new FlagClient(FlagClientConfig.builder("srv_secret").enableRealtime(false).build()).close();
        assertEquals(Collections.emptyList(), plainHttpWarnings());
    }

    @Test
    void loopbackLookalikesStillWarn() {
        for (String url : Arrays.asList("http://localhost.example.com", "http://127.0.0.2",
                "http://10.0.0.5:8080")) {
            assertEquals("Savvagent Flags: the server key will be sent over http; use an https base_url",
                    FlagClient.plainHttpWarning("srv_secret", url), url);
        }
    }

    @Test
    void warningNeverContainsTheKey() {
        client("srv_do_not_log_me", "http://flags.example.com").close();
        for (String warning : CapturingLogs.warnings()) {
            assertTrue(!warning.contains("srv_do_not_log_me"), warning);
        }
    }
}
