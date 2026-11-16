package com.savvagent.flags.example;

import com.savvagent.flags.sdk.FlagClient;
import com.savvagent.flags.sdk.FlagClientConfig;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class SavvagentFlagsConfig {

    @Value("${savvagentFlags.api-url}")
    private String apiUrl;

    @Value("${savvagentFlags.sdk-key}")
    private String sdkKey;

    @Bean(destroyMethod = "close")
    public FlagClient savvagentFlagsClient() {
        return new FlagClient(
            FlagClientConfig.builder(sdkKey)
                .baseUrl(apiUrl)
                .cacheTtl(60000L) // 1 minute
                .build()
        );
    }
}
