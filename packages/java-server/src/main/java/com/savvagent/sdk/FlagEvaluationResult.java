package com.savvagent.sdk;

/**
 * Result from flag evaluation
 */
public class FlagEvaluationResult {
    private final String key;
    private final boolean value;
    private final Object configuration;
    private final String variation;
    private final String reason;
    private final Metadata metadata;

    public FlagEvaluationResult(String key, boolean value, String reason, Metadata metadata) {
        this(key, value, null, null, reason, metadata);
    }

    public FlagEvaluationResult(String key, boolean value, Object configuration, String variation, String reason, Metadata metadata) {
        this.key = key;
        this.value = value;
        this.configuration = configuration;
        this.variation = variation;
        this.reason = reason;
        this.metadata = metadata;
    }

    public String getKey() { return key; }
    public boolean getValue() { return value; }
    public Object getConfiguration() { return configuration; }
    public String getVariation() { return variation; }
    public String getReason() { return reason; }
    public Metadata getMetadata() { return metadata; }

    public static class Metadata {
        private String flagId;
        private String description;
        private String variant;

        public String getFlagId() { return flagId; }
        public void setFlagId(String flagId) { this.flagId = flagId; }

        public String getDescription() { return description; }
        public void setDescription(String description) { this.description = description; }

        public String getVariant() { return variant; }
        public void setVariant(String variant) { this.variant = variant; }
    }
}
