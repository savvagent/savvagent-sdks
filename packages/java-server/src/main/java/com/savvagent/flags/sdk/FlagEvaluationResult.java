package com.savvagent.flags.sdk;

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
        private Long version;
        private String scope;

        /** Not sent by the savvagent-flags server; null unless a server sends it. */
        public String getFlagId() { return flagId; }
        public void setFlagId(String flagId) { this.flagId = flagId; }

        /** Not sent by the savvagent-flags server; null unless a server sends it. */
        public String getDescription() { return description; }
        public void setDescription(String description) { this.description = description; }

        /** Not sent by the savvagent-flags server; null unless a server sends it. */
        public String getVariant() { return variant; }
        public void setVariant(String variant) { this.variant = variant; }

        /** The flag version the server evaluated, or null when it sent none or a malformed one. */
        public Long getVersion() { return version; }
        public void setVersion(Long version) { this.version = version; }

        /** The scope the server evaluated the flag at (for example "application"), or null. */
        public String getScope() { return scope; }
        public void setScope(String scope) { this.scope = scope; }
    }
}
