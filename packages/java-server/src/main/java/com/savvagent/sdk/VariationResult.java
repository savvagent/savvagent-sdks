package com.savvagent.sdk;

/**
 * Result from variation evaluation for multi-variant flags
 */
public class VariationResult {
    private final String variation;
    private final boolean enabled;
    private final Object configuration;

    public VariationResult(String variation, boolean enabled, Object configuration) {
        this.variation = variation;
        this.enabled = enabled;
        this.configuration = configuration;
    }

    public String getVariation() { return variation; }
    public boolean isEnabled() { return enabled; }
    public Object getConfiguration() { return configuration; }
}
