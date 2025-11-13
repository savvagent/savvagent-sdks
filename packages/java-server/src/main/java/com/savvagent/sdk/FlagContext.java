package com.savvagent.sdk;

import java.util.HashMap;
import java.util.Map;

/**
 * Context for flag evaluation
 */
public class FlagContext {
    private String userId;
    private String sessionId;
    private String applicationId;
    private Map<String, Object> attributes;
    private String environment;
    private String ipAddress;
    private String userAgent;

    public FlagContext() {
        this.attributes = new HashMap<>();
    }

    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }

    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }

    public String getApplicationId() { return applicationId; }
    public void setApplicationId(String applicationId) { this.applicationId = applicationId; }

    public Map<String, Object> getAttributes() { return attributes; }
    public void setAttributes(Map<String, Object> attributes) { this.attributes = attributes; }
    public void setAttribute(String key, Object value) { this.attributes.put(key, value); }

    public String getEnvironment() { return environment; }
    public void setEnvironment(String environment) { this.environment = environment; }

    public String getIpAddress() { return ipAddress; }
    public void setIpAddress(String ipAddress) { this.ipAddress = ipAddress; }

    public String getUserAgent() { return userAgent; }
    public void setUserAgent(String userAgent) { this.userAgent = userAgent; }

    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private FlagContext context = new FlagContext();

        public Builder userId(String userId) {
            context.setUserId(userId);
            return this;
        }

        public Builder sessionId(String sessionId) {
            context.setSessionId(sessionId);
            return this;
        }

        public Builder applicationId(String applicationId) {
            context.setApplicationId(applicationId);
            return this;
        }

        public Builder attribute(String key, Object value) {
            context.setAttribute(key, value);
            return this;
        }

        public Builder attributes(Map<String, Object> attributes) {
            context.setAttributes(attributes);
            return this;
        }

        public Builder environment(String environment) {
            context.setEnvironment(environment);
            return this;
        }

        public Builder ipAddress(String ipAddress) {
            context.setIpAddress(ipAddress);
            return this;
        }

        public Builder userAgent(String userAgent) {
            context.setUserAgent(userAgent);
            return this;
        }

        public FlagContext build() {
            return context;
        }
    }
}
