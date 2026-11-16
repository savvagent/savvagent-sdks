package com.savvagent.flags.example;

import com.savvagent.flags.sdk.FlagContext;
import com.savvagent.flags.sdk.FlagClient;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
public class FeatureController {

    private final FlagClient savvagentFlags;

    @Autowired
    public FeatureController(FlagClient savvagentFlags) {
        this.savvagentFlags = savvagentFlags;
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        Map<String, String> response = new HashMap<>();
        response.put("status", "ok");
        return ResponseEntity.ok(response);
    }

    @GetMapping("/api/features")
    public ResponseEntity<Map<String, Object>> getFeatures(
        @RequestParam String userId
    ) {
        try {
            FlagContext context = FlagContext.builder()
                .userId(userId)
                .build();

            boolean newUI = savvagentFlags.isEnabled("new-ui", context);
            boolean betaFeatures = savvagentFlags.isEnabled("beta-features", context);
            boolean advancedAnalytics = savvagentFlags.isEnabled("advanced-analytics", context);

            Map<String, Boolean> features = new HashMap<>();
            features.put("newUI", newUI);
            features.put("betaFeatures", betaFeatures);
            features.put("advancedAnalytics", advancedAnalytics);

            Map<String, Object> response = new HashMap<>();
            response.put("userId", userId);
            response.put("features", features);

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", "Failed to check feature flags");
            error.put("message", e.getMessage());
            return ResponseEntity.status(500).body(error);
        }
    }

    @PostMapping("/api/data")
    public ResponseEntity<Map<String, Object>> processData(
        @RequestBody Map<String, Object> request
    ) {
        try {
            String userId = (String) request.getOrDefault("userId", "anonymous");

            FlagContext context = FlagContext.builder()
                .userId(userId)
                .attribute("endpoint", "/api/data")
                .build();

            boolean advancedProcessing = savvagentFlags.isEnabled("advanced-processing", context);

            Map<String, Object> response = new HashMap<>();
            response.put("processed", true);
            response.put("method", advancedProcessing ? "advanced" : "basic");
            response.put("data", request.get("data"));

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", "Failed to process data");
            error.put("message", e.getMessage());
            return ResponseEntity.status(500).body(error);
        }
    }
}
