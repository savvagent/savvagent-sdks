package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/savvagent/savvagent-go-server-sdk/pkg/savvagent"
)

func main() {
	// Initialize Savvagent client
	client := savvagent.NewClient(savvagent.Config{
		APIURL:      getEnv("SAVVAGENT_API_URL", "http://localhost:8080"),
		SDKKey:      getEnv("SAVVAGENT_SDK_KEY", "your-sdk-key"),
		Environment: "development",
		Cache: savvagent.CacheConfig{
			Enabled: true,
			TTL:     60, // 1 minute
		},
	})
	defer client.Close()

	// Setup Gin router
	r := gin.Default()

	// Health check endpoint
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
		})
	})

	// Get user features
	r.GET("/api/features", func(c *gin.Context) {
		userId := c.Query("userId")
		if userId == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "userId is required",
			})
			return
		}

		ctx := savvagent.EvaluationContext{
			UserID:     userId,
			Attributes: make(map[string]interface{}),
		}

		// Check multiple feature flags concurrently
		newUI, err1 := client.IsEnabled("new-ui", ctx)
		betaFeatures, err2 := client.IsEnabled("beta-features", ctx)
		advancedAnalytics, err3 := client.IsEnabled("advanced-analytics", ctx)

		if err1 != nil || err2 != nil || err3 != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to check feature flags",
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"userId": userId,
			"features": gin.H{
				"newUI":              newUI,
				"betaFeatures":       betaFeatures,
				"advancedAnalytics":  advancedAnalytics,
			},
		})
	})

	// Process data with feature-gated functionality
	r.POST("/api/data", func(c *gin.Context) {
		var request struct {
			UserID string      `json:"userId"`
			Data   interface{} `json:"data"`
		}

		if err := c.BindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid request body",
			})
			return
		}

		userId := request.UserID
		if userId == "" {
			userId = "anonymous"
		}

		ctx := savvagent.EvaluationContext{
			UserID: userId,
			Attributes: map[string]interface{}{
				"endpoint": "/api/data",
			},
		}

		advancedProcessing, err := client.IsEnabled("advanced-processing", ctx)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to check feature flag",
			})
			return
		}

		method := "basic"
		if advancedProcessing {
			method = "advanced"
		}

		c.JSON(http.StatusOK, gin.H{
			"processed": true,
			"method":    method,
			"data":      request.Data,
		})
	})

	// Start server
	port := getEnv("PORT", "8082")
	log.Printf("Server starting on port %s", port)
	log.Printf("Savvagent API URL: %s", client.GetConfig().APIURL)

	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}
