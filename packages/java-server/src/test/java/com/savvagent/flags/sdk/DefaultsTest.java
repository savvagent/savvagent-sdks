package com.savvagent.flags.sdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Defaults that come from somewhere other than a constant (#31): {@code defaultFromEnv} and
 * {@code defaultFrom}, both resolved once, when the builder method is called.
 */
class DefaultsTest {

    @BeforeEach
    void clearLogs() {
        CapturingLogs.clear();
    }

    private static FlagClientConfig.Builder builder() {
        return FlagClientConfig.builder("sdk_test").enableRealtime(false);
    }

    private static Map<String, String> env(String... pairs) {
        Map<String, String> env = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            env.put(pairs[i], pairs[i + 1]);
        }
        return env;
    }

    @Test
    void envValuesParseAsBooleans() {
        for (String yes : Arrays.asList("1", "true", "TRUE", "yes", "Yes", "on", "ON", "  true\n", "\ttrue ")) {
            FlagClientConfig config = builder().defaultFromEnv("f", "FLAG", env("FLAG", yes)::get).build();
            assertEquals(Boolean.TRUE, config.getDefaults().get("f"), "value " + yes);
        }
        for (String no : Arrays.asList("0", "false", "False", "no", "NO", "off", "Off", " 0 ")) {
            FlagClientConfig config = builder()
                    .defaults(Collections.singletonMap("f", true))
                    .defaultFromEnv("f", "FLAG", env("FLAG", no)::get).build();
            assertEquals(Boolean.FALSE, config.getDefaults().get("f"), "value " + no);
        }
        assertEquals(Collections.emptyList(), CapturingLogs.warnings());
    }

    @Test
    void unsetVariableIsIgnoredSilently() {
        FlagClientConfig config = builder()
                .defaults(Collections.singletonMap("f", true))
                .defaultFromEnv("f", "FLAG", env()::get)
                .defaultFromEnv("g", "OTHER", env()::get)
                .build();
        assertEquals(Boolean.TRUE, config.getDefaults().get("f"));
        assertNull(config.getDefaults().get("g"));
        assertEquals(Collections.emptyList(), CapturingLogs.warnings());
    }

    @Test
    void emptyOrInvalidVariableIsIgnoredWithAWarningThatNamesOnlyTheVariable() {
        for (String bad : Arrays.asList("", "   ", "maybe", "secret-value-42", "2", "truee")) {
            CapturingLogs.clear();
            FlagClientConfig config = builder()
                    .defaults(Collections.singletonMap("f", true))
                    .defaultFromEnv("f", "NEW_CHECKOUT_ENABLED", env("NEW_CHECKOUT_ENABLED", bad)::get)
                    .build();
            assertEquals(Boolean.TRUE, config.getDefaults().get("f"), "value " + bad);
            List<String> warnings = CapturingLogs.warnings();
            assertEquals(1, warnings.size(), warnings.toString());
            assertEquals("Savvagent Flags: environment variable \"NEW_CHECKOUT_ENABLED\" is not a boolean;"
                    + " ignoring it", warnings.get(0));
            if (!bad.trim().isEmpty()) {
                assertFalse(warnings.get(0).contains(bad), warnings.get(0));
            }
        }
    }

    @Test
    void publicDefaultFromEnvReadsTheProcessEnvironment() {
        // The surefire configuration sets this variable for the test JVM.
        String name = "SAVVAGENT_FLAGS_JAVA_TEST_DEFAULT";
        assertEquals("Yes", System.getenv(name));
        FlagClientConfig config = builder().defaultFromEnv("from-env", name)
                .defaultFromEnv("unset", "SAVVAGENT_FLAGS_JAVA_TEST_UNSET_VARIABLE")
                .build();
        assertEquals(Boolean.TRUE, config.getDefaults().get("from-env"));
        assertNull(config.getDefaults().get("unset"));
    }

    @Test
    void defaultFromCallsTheSupplierOnceAtTheCall() {
        AtomicInteger calls = new AtomicInteger();
        FlagClientConfig.Builder builder = builder().defaultFrom("f", () -> {
            calls.incrementAndGet();
            return Optional.of(true);
        });
        assertEquals(1, calls.get());
        FlagClientConfig config = builder.build();
        try (FlagClient client = new FlagClient(config)) {
            assertTrue(client.isEnabledCached("f"));
            assertTrue(client.isEnabledCached("f"));
        }
        assertEquals(1, calls.get());
    }

    @Test
    void emptyOrNullSupplierResultLeavesEarlierDefault() {
        FlagClientConfig config = builder()
                .defaults(Collections.singletonMap("f", true))
                .defaultFrom("f", Optional::empty)
                .defaultFrom("f", () -> null)
                .defaultFrom("g", Optional::empty)
                .build();
        assertEquals(Boolean.TRUE, config.getDefaults().get("f"));
        assertFalse(config.getDefaults().containsKey("g"));
    }

    @Test
    void laterCallsOverrideEarlierOnes() {
        FlagClientConfig config = builder()
                .defaultFrom("f", () -> Optional.of(true))
                .defaultFromEnv("f", "FLAG", env("FLAG", "off")::get)
                .build();
        assertEquals(Boolean.FALSE, config.getDefaults().get("f"));
    }

    @Test
    void theCallersMapIsNeverModified() {
        Map<String, Boolean> mine = Collections.singletonMap("a", true); // immutable: a write throws
        FlagClientConfig config = builder().defaults(mine)
                .defaultFrom("b", () -> Optional.of(false))
                .build();
        assertEquals(Boolean.TRUE, config.getDefaults().get("a"));
        assertEquals(Boolean.FALSE, config.getDefaults().get("b"));
        assertEquals(1, mine.size());
    }

    @Test
    void nullDefaultsMapStillAcceptsDerivedDefaults() {
        FlagClientConfig config = builder().defaults(null).defaultFrom("b", () -> Optional.of(true)).build();
        assertEquals(Boolean.TRUE, config.getDefaults().get("b"));
    }

    @Test
    void derivedDefaultIsWhatAFailedLookupReturns() {
        // Nothing listens on this port, so the lookup fails and falls back to the default.
        try (FlagClient client = new FlagClient(builder()
                .baseUrl("http://127.0.0.1:9")
                .timeout(500)
                .onError(e -> { })
                .defaultFromEnv("new-checkout", "FLAG", env("FLAG", "yes")::get)
                .build())) {
            FlagEvaluationResult result = client.evaluate("new-checkout", null);
            assertTrue(result.getValue());
            assertEquals("error", result.getReason());
        }
    }

    @Test
    void defaultsMapAndDerivedDefaultsGiveTheSameResultInEitherOrder() {
        Map<String, Boolean> base = new HashMap<>();
        base.put("f", false);
        base.put("kept", true);
        FlagClientConfig derivedFirst = builder()
                .defaultFromEnv("f", "FLAG", env("FLAG", "yes")::get)
                .defaultFrom("g", () -> Optional.of(true))
                .defaults(base)
                .build();
        FlagClientConfig derivedLast = builder()
                .defaults(base)
                .defaultFromEnv("f", "FLAG", env("FLAG", "yes")::get)
                .defaultFrom("g", () -> Optional.of(true))
                .build();
        assertEquals(derivedLast.getDefaults(), derivedFirst.getDefaults());
        assertEquals(Boolean.TRUE, derivedFirst.getDefaults().get("f"));
        assertEquals(Boolean.TRUE, derivedFirst.getDefaults().get("g"));
        assertEquals(Boolean.TRUE, derivedFirst.getDefaults().get("kept"));
        assertEquals(Boolean.FALSE, base.get("f"));
    }

    @Test
    void sameKeyConflictLaterDerivedCallWinsAndDerivedBeatsBase() {
        FlagClientConfig config = builder()
                .defaultFrom("f", () -> Optional.of(true))
                .defaults(Collections.singletonMap("f", true))
                .defaultFromEnv("f", "FLAG", env("FLAG", "off")::get)
                .build();
        assertEquals(Boolean.FALSE, config.getDefaults().get("f"));
    }

    @Test
    void unsetEnvKeepsTheBaseDefaultEvenWhenDefaultsComesAfter() {
        FlagClientConfig config = builder()
                .defaultFromEnv("f", "FLAG", env()::get)
                .defaults(Collections.singletonMap("f", true))
                .build();
        assertEquals(Boolean.TRUE, config.getDefaults().get("f"));
    }

    @Test
    void callingDefaultsTwiceStillReplacesTheBaseMap() {
        FlagClientConfig config = builder()
                .defaults(Collections.singletonMap("a", true))
                .defaultFrom("b", () -> Optional.of(true))
                .defaults(Collections.singletonMap("c", true))
                .build();
        assertFalse(config.getDefaults().containsKey("a"));
        assertEquals(Boolean.TRUE, config.getDefaults().get("b"));
        assertEquals(Boolean.TRUE, config.getDefaults().get("c"));
    }
}
