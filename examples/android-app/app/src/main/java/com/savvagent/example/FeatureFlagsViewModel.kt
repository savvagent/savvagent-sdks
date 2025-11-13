package com.savvagent.example

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.savvagent.sdk.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class FeatureFlag(
    val key: String,
    val title: String,
    val description: String,
    val isEnabled: Boolean
)

data class FeatureFlagsUiState(
    val flags: List<FeatureFlag> = emptyList(),
    val isLoading: Boolean = true,
    val error: String? = null
) {
    fun isFeatureEnabled(key: String): Boolean {
        return flags.find { it.key == key }?.isEnabled ?: false
    }
}

class FeatureFlagsViewModel(application: Application) : AndroidViewModel(application) {
    private val client: SavvagentClient

    private val _uiState = MutableStateFlow(FeatureFlagsUiState())
    val uiState: StateFlow<FeatureFlagsUiState> = _uiState.asStateFlow()

    private val userContext = UserContext(
        userId = "demo-user",
        attributes = mapOf(
            "email" to "demo@example.com",
            "plan" to "pro"
        )
    )

    private val featureFlagDefinitions = listOf(
        Triple("new-ui", "New UI", "Modern redesigned user interface"),
        Triple("dark-mode", "Dark Mode", "System-wide dark mode support"),
        Triple("premium-features", "Premium Features", "Access to premium functionality")
    )

    init {
        val config = SavvagentConfig(
            apiUrl = "https://beta.savvagent.com",
            sdkKey = "demo-sdk-key",
            environment = "development",
            enableLogging = true
        )

        client = SavvagentClient(config, application)

        loadFlags()
    }

    fun refreshFlags() {
        loadFlags()
    }

    private fun loadFlags() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            try {
                val flags = featureFlagDefinitions.map { (key, title, description) ->
                    val result = client.isEnabled(key, userContext)
                    val isEnabled = result.getOrDefault(false)

                    FeatureFlag(
                        key = key,
                        title = title,
                        description = description,
                        isEnabled = isEnabled
                    )
                }

                _uiState.update {
                    it.copy(
                        flags = flags,
                        isLoading = false,
                        error = null
                    )
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = e.message ?: "Unknown error occurred"
                    )
                }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        client.close()
    }
}
