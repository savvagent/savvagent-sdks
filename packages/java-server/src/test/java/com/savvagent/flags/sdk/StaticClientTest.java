package com.savvagent.flags.sdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.Test;

/**
 * {@code FlagClient.staticFlags} (#31): fixed values for tests, never a request.
 */
class StaticClientTest {

    private static Map<String, Boolean> flags() {
        Map<String, Boolean> flags = new HashMap<>();
        flags.put("new-checkout", true);
        flags.put("old-banner", false);
        return flags;
    }

    @Test
    void listedFlagsHaveTheirValueAndOthersAreFalse() {
        try (FlagClient client = FlagClient.staticFlags(flags())) {
            assertTrue(client.isEnabled("new-checkout"));
            assertTrue(client.isEnabled("new-checkout", FlagContext.builder().userId("u").build()));
            assertTrue(client.isEnabledCached("new-checkout"));
            assertFalse(client.isEnabled("old-banner"));
            assertFalse(client.isEnabledCached("old-banner"));
            assertFalse(client.isEnabled("anything-else"));
            assertFalse(client.isEnabledCached("anything-else"));
        }
    }

    @Test
    void evaluateReportsReasonStatic() {
        try (FlagClient client = FlagClient.staticFlags(flags())) {
            FlagEvaluationResult listed = client.evaluate("new-checkout", null);
            assertEquals("new-checkout", listed.getKey());
            assertTrue(listed.getValue());
            assertEquals("static", listed.getReason());
            assertNull(listed.getConfiguration());
            assertNull(listed.getVariation());

            FlagEvaluationResult unlisted = client.evaluate("anything-else", null);
            assertFalse(unlisted.getValue());
            assertEquals("static", unlisted.getReason());
        }
    }

    @Test
    void overridesStillApply() {
        try (FlagClient client = FlagClient.staticFlags(flags())) {
            client.setConfigOverride("new-checkout", Collections.singletonMap("color", "blue"));
            client.setVariationOverride("new-checkout", "treatment");
            assertEquals(Collections.singletonMap("color", "blue"), client.getConfig("new-checkout"));
            VariationResult variation = client.getVariation("new-checkout");
            assertEquals("treatment", variation.getVariation());
            assertTrue(variation.isEnabled());
            // An override never changes the value.
            client.setVariationOverride("anything-else", "treatment");
            assertFalse(client.isEnabled("anything-else"));
            assertEquals("control", client.getVariation("new-checkout-2").getVariation());
        }
    }

    @Test
    void theCallersMapIsCopied() {
        Map<String, Boolean> mine = flags();
        try (FlagClient client = FlagClient.staticFlags(mine)) {
            mine.put("new-checkout", false);
            mine.put("late", true);
            assertTrue(client.isEnabled("new-checkout"));
            assertFalse(client.isEnabled("late"));
        }
    }

    @Test
    void nullMapAndNullValuesAreFalse() {
        try (FlagClient client = FlagClient.staticFlags(null)) {
            assertFalse(client.isEnabled("x"));
        }
        Map<String, Boolean> withNull = new HashMap<>();
        withNull.put("x", null);
        try (FlagClient client = FlagClient.staticFlags(withNull)) {
            assertFalse(client.isEnabled("x"));
            assertFalse(client.isEnabledCached("x"));
        }
    }

    @Test
    void neverOpensTheStream() {
        try (FlagClient client = FlagClient.staticFlags(flags())) {
            assertNull(client.realtimeStream());
        }
    }

    @Test
    void neverTouchesTheNetwork() throws Exception {
        MockWebServer server = new MockWebServer();
        // Were a request made, it would succeed with the opposite answer.
        for (int i = 0; i < 20; i++) {
            server.enqueue(new MockResponse().setHeader("Content-Type", "application/json")
                    .setBody("{\"enabled\":false}"));
        }
        server.start();
        try (FlagClient client = FlagClient.staticFlags(flags(), server.url("/").toString())) {
            assertTrue(client.isEnabled("new-checkout"));
            assertTrue(client.isEnabled("new-checkout", FlagContext.builder().userId("u").build()));
            assertTrue(client.evaluate("new-checkout", null).getValue());
            assertTrue(client.isEnabledCached("new-checkout"));
            client.getConfig("new-checkout");
            client.getConfig("new-checkout", null, Map.class);
            client.getVariation("new-checkout");
            client.invalidateCache(null);
            assertTrue(client.isEnabled("new-checkout"));
            client.clearAllOverrides();
        } finally {
            assertEquals(0, server.getRequestCount());
            server.shutdown();
        }
    }
}
