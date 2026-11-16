package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	savvagentflags "github.com/savvagent/flags-sdks/packages/go-server"
)

func main() {
	// Initialize Savvagent Flags client
	client, err := savvagentflags.NewClient(savvagentflags.Config{
		APIKey:  getEnv("SAVVAGENT_SDK_KEY", "sdk_your_sdk_key"),
		BaseURL: getEnv("SAVVAGENT_API_URL", "http://localhost:8080"),
		Defaults: map[string]bool{
			"new-ui":              false,
			"beta-features":       false,
			"advanced-analytics":  false,
			"advanced-processing": false,
		},
	})
	if err != nil {
		log.Fatalf("Failed to create Savvagent Flags client: %v", err)
	}
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

		ctx := &savvagentflags.Context{
			UserID:      userId,
			Environment: getEnv("SAVVAGENT_ENVIRONMENT", "development"),
			Attributes:  make(map[string]interface{}),
		}

		// Check multiple feature flags
		newUI := client.IsEnabled("new-ui", ctx)
		betaFeatures := client.IsEnabled("beta-features", ctx)
		advancedAnalytics := client.IsEnabled("advanced-analytics", ctx)

		c.JSON(http.StatusOK, gin.H{
			"userId": userId,
			"features": gin.H{
				"newUI":             newUI,
				"betaFeatures":      betaFeatures,
				"advancedAnalytics": advancedAnalytics,
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

		ctx := &savvagentflags.Context{
			UserID: userId,
			Attributes: map[string]interface{}{
				"endpoint": "/api/data",
			},
		}

		advancedProcessing := client.IsEnabled("advanced-processing", ctx)

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
	log.Printf("Savvagent Flags API URL: %s", getEnv("SAVVAGENT_API_URL", "http://localhost:8080"))

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
