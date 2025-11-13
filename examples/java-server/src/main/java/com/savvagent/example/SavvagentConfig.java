package com.savvagent.example;

import com.savvagent.sdk.SavvagentClient;
import com.savvagent.sdk.SavvagentConfig;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class SavvagentConfig {

    @Value("${savvagent.api-url}")
    private String apiUrl;

    @Value("${savvagent.sdk-key}")
    private String sdkKey;

    @Value("${savvagent.environment}")
    private String environment;

    @Bean
    public SavvagentClient savvagentClient() {
        return new SavvagentClient(
            SavvagentConfig.builder()
                .apiUrl(apiUrl)
                .sdkKey(sdkKey)
                .environment(environment)
                .cacheEnabled(true)
                .cacheTtl(60000) // 1 minute
                .build()
        );
    }
}
