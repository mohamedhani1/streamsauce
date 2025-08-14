package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// Configuration
const (
	ENCRYPTION_KEY   = "EvMimti9L6yB7As37tH2VdjzLoBxYHts" // Must be 32 characters
	JWT_SECRET       = "12d0db4611a7405dde7c901713fa2ba1"
	JWT_EXPIRE_HOURS = 24
)

// Database models
type IPTVHoster struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	Name         string    `json:"name" gorm:"unique;not null"`
	Logo         string    `json:"logo"`
	ColorPalette string    `json:"color_palette"`
	CreatedAt    time.Time `json:"created_at"`
}

type User struct {
	ID            uint           `json:"id" gorm:"primaryKey"`
	Name          string         `json:"name" gorm:"not null"`
	Avatar        string         `json:"avatar"`
	TeleUsername  string         `json:"tele_username"`
	Reference     string         `json:"reference"`
	IsAdmin       bool           `json:"is_admin" gorm:"default:false"`
	IsHoster      bool           `json:"is_hoster" gorm:"default:false"`
	IPTVHosterID  *uint          `json:"iptv_hoster_id"`
	IPTVHoster    *IPTVHoster    `json:"iptv_hoster,omitempty" gorm:"foreignKey:IPTVHosterID"`
	Subscriptions []Subscription `json:"subscriptions,omitempty"`
	CreatedAt     time.Time      `json:"created_at"`
}

type Admin struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	Username  string    `json:"username" gorm:"unique;not null"`
	Password  string    `json:"-" gorm:"not null"` // Hidden from JSON
	CreatedAt time.Time `json:"created_at"`
}

type Subscription struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	UserID    uint      `json:"user_id"`
	User      User      `json:"user,omitempty" gorm:"foreignKey:UserID"`
	Started   time.Time `json:"started"`
	End       time.Time `json:"end"`
	Payed     float64   `json:"payed"`
	Key       string    `json:"key"`
	CreatedAt time.Time `json:"created_at"`
}

type Package struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	Name      string    `json:"name" gorm:"unique;not null"`
	Logo      string    `json:"logo"`
	Channels  []Channel `json:"channels,omitempty" gorm:"many2many:package_channels;"`
	CreatedAt time.Time `json:"created_at"`
}

type Channel struct {
	ID            uint      `json:"id" gorm:"primaryKey"`
	Name          string    `json:"name" gorm:"not null"`
	Logo          string    `json:"logo"`
	MPD           string    `json:"mpd"`
	Key           string    `json:"key"`
	LastRefreshed time.Time `json:"last_refreshed"`
	ExpiresEvery  int64     `json:"expires_every"`
	Packages      []Package `json:"packages,omitempty" gorm:"many2many:package_channels;"`
	CreatedAt     time.Time `json:"created_at"`
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type EncryptedResponse struct {
	Data string `json:"data"`
}

var db *gorm.DB

// Initialize database
func initDB() {
	var err error
	db, err = gorm.Open(sqlite.Open("iptv.db"), &gorm.Config{})
	if err != nil {
		panic("Failed to connect to database")
	}

	// Auto migrate tables
	db.AutoMigrate(&IPTVHoster{}, &User{}, &Subscription{}, &Package{}, &Channel{}, &Admin{})

	// Create default admin if not exists
	var admin Admin
	if db.Where("username = ?", "admin").First(&admin).Error != nil {
		defaultAdmin := Admin{
			Username:  "admin",
			Password:  "admin123", // In production, hash this password
			CreatedAt: time.Now(),
		}
		db.Create(&defaultAdmin)
	}
}

// Encryption functions
func encrypt(plaintext, key string) (string, error) {
	block, err := aes.NewCipher([]byte(key))
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func decrypt(ciphertext, key string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher([]byte(key))
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	nonce, cipherData := data[:nonceSize], data[nonceSize:]

	plaintext, err := gcm.Open(nil, nonce, cipherData, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}

// JWT functions
func generateJWT(username string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"username": username,
		"exp":      time.Now().Add(time.Hour * JWT_EXPIRE_HOURS).Unix(),
		"iat":      time.Now().Unix(),
	})

	return token.SignedString([]byte(JWT_SECRET))
}

func validateJWT(tokenString string) (*jwt.Token, error) {
	return jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return []byte(JWT_SECRET), nil
	})
}

// Middleware for encrypted responses
func encryptResponse() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Create a buffer to capture the response
		writer := &responseWriter{
			ResponseWriter: c.Writer,
			body:          bytes.NewBuffer([]byte{}),
		}
		c.Writer = writer

		c.Next()

		// Check if we have content to encrypt
		if writer.body.Len() > 0 {
			encrypted, err := encrypt(writer.body.String(), ENCRYPTION_KEY)
			if err != nil {
				// Restore original writer and send error
				c.Writer = writer.ResponseWriter
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Encryption failed: " + err.Error()})
				return
			}
			
			// Restore original writer and send encrypted response
			c.Writer = writer.ResponseWriter
			c.Header("Content-Type", "application/json")
			c.JSON(http.StatusOK, EncryptedResponse{Data: encrypted})
		} else {
			// If no content, restore writer and let the original response through
			c.Writer = writer.ResponseWriter
		}
	}
}

// Custom response writer to capture response body
type responseWriter struct {
	gin.ResponseWriter
	body *bytes.Buffer
}

func (w *responseWriter) Write(b []byte) (int, error) {
	// Only capture the body, don't write to original response yet
	return w.body.Write(b)
}

// JWT Authentication middleware
func jwtAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}

		tokenString := strings.Replace(authHeader, "Bearer ", "", 1)
		token, err := validateJWT(tokenString)

		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			c.Abort()
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims"})
			c.Abort()
			return
		}

		c.Set("username", claims["username"])
		c.Next()
	}
}

// Auth endpoints
func login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var admin Admin
	if db.Where("username = ? AND password = ?", req.Username, req.Password).First(&admin).Error != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	token, err := generateJWT(admin.Username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Token generation failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":      token,
		"expires_in": JWT_EXPIRE_HOURS * 3600,
	})
}

// Public encrypted endpoints
func getAllChannels(c *gin.Context) {
	var channels []Channel
	db.Find(&channels)
	c.JSON(http.StatusOK, channels)
}

func getAllPackages(c *gin.Context) {
	var packages []Package
	db.Preload("Channels").Find(&packages)
	c.JSON(http.StatusOK, packages)
}

// Admin Channel endpoints
func addChannel(c *gin.Context) {
	var channel Channel
	if err := c.ShouldBindJSON(&channel); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	channel.CreatedAt = time.Now()
	if channel.LastRefreshed.IsZero() {
		channel.LastRefreshed = time.Now()
	}

	if result := db.Create(&channel); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create channel"})
		return
	}

	c.JSON(http.StatusCreated, channel)
}

func getAdminChannels(c *gin.Context) {
	var channels []Channel
	db.Find(&channels)
	c.JSON(http.StatusOK, channels)
}

func updateChannel(c *gin.Context) {
	id := c.Param("id")
	var channel Channel

	if db.First(&channel, id).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Channel not found"})
		return
	}

	if err := c.ShouldBindJSON(&channel); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	db.Save(&channel)
	c.JSON(http.StatusOK, channel)
}

func deleteChannel(c *gin.Context) {
	id := c.Param("id")
	if result := db.Delete(&Channel{}, id); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete channel"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Channel deleted successfully"})
}

// Admin Package endpoints
func getAdminPackages(c *gin.Context) {
	var packages []Package
	db.Preload("Channels").Find(&packages)
	c.JSON(http.StatusOK, packages)
}

func addPackage(c *gin.Context) {
	var pkg Package
	if err := c.ShouldBindJSON(&pkg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pkg.CreatedAt = time.Now()
	if result := db.Create(&pkg); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create package"})
		return
	}

	c.JSON(http.StatusCreated, pkg)
}

func updatePackage(c *gin.Context) {
	id := c.Param("id")
	var pkg Package

	if db.First(&pkg, id).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Package not found"})
		return
	}

	if err := c.ShouldBindJSON(&pkg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	db.Save(&pkg)
	c.JSON(http.StatusOK, pkg)
}

func deletePackage(c *gin.Context) {
	id := c.Param("id")
	if result := db.Delete(&Package{}, id); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete package"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Package deleted successfully"})
}

// Admin User endpoints
func getAllUsers(c *gin.Context) {
	var users []User
	db.Preload("IPTVHoster").Preload("Subscriptions").Find(&users)
	c.JSON(http.StatusOK, users)
}

func getUser(c *gin.Context) {
	id := c.Param("id")
	var user User

	if db.Preload("IPTVHoster").Preload("Subscriptions").First(&user, id).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	c.JSON(http.StatusOK, user)
}

func addUser(c *gin.Context) {
	var user User
	if err := c.ShouldBindJSON(&user); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user.CreatedAt = time.Now()
	if result := db.Create(&user); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		return
	}

	c.JSON(http.StatusCreated, user)
}

func updateUser(c *gin.Context) {
	id := c.Param("id")
	var user User

	if db.First(&user, id).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	if err := c.ShouldBindJSON(&user); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	db.Save(&user)
	c.JSON(http.StatusOK, user)
}

func deleteUser(c *gin.Context) {
	id := c.Param("id")
	if result := db.Delete(&User{}, id); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete user"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "User deleted successfully"})
}

// Admin IPTV Hoster endpoints
func getAllHosters(c *gin.Context) {
	var hosters []IPTVHoster
	db.Find(&hosters)
	c.JSON(http.StatusOK, hosters)
}

func addHoster(c *gin.Context) {
	var hoster IPTVHoster
	if err := c.ShouldBindJSON(&hoster); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hoster.CreatedAt = time.Now()
	if result := db.Create(&hoster); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create hoster"})
		return
	}

	c.JSON(http.StatusCreated, hoster)
}

func updateHoster(c *gin.Context) {
	id := c.Param("id")
	var hoster IPTVHoster

	if db.First(&hoster, id).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Hoster not found"})
		return
	}

	if err := c.ShouldBindJSON(&hoster); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	db.Save(&hoster)
	c.JSON(http.StatusOK, hoster)
}

func deleteHoster(c *gin.Context) {
	id := c.Param("id")
	if result := db.Delete(&IPTVHoster{}, id); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete hoster"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Hoster deleted successfully"})
}

// Subscription endpoints
func getAllSubscriptions(c *gin.Context) {
	var subscriptions []Subscription
	db.Preload("User").Find(&subscriptions)
	c.JSON(http.StatusOK, subscriptions)
}

func getSubscription(c *gin.Context) {
	id := c.Param("id")
	var subscription Subscription

	if db.Preload("User").First(&subscription, id).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}

	c.JSON(http.StatusOK, subscription)
}

func addSubscription(c *gin.Context) {
	var subscription Subscription
	if err := c.ShouldBindJSON(&subscription); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	// Set creation time
	subscription.CreatedAt = time.Now()
	
	// Validate dates
	if subscription.Started.IsZero() {
		subscription.Started = time.Now()
	}
	if subscription.End.IsZero() {
		subscription.End = time.Now().AddDate(0, 1, 0) // Default to 1 month from now
	}
	
	if result := db.Create(&subscription); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create subscription"})
		return
	}
	
	c.JSON(http.StatusCreated, subscription)
}

func updateSubscription(c *gin.Context) {
	id := c.Param("id")
	var subscription Subscription

	if db.First(&subscription, id).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subscription not found"})
		return
	}

	if err := c.ShouldBindJSON(&subscription); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	db.Save(&subscription)
	c.JSON(http.StatusOK, subscription)
}

func deleteSubscription(c *gin.Context) {
	id := c.Param("id")
	if result := db.Delete(&Subscription{}, id); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete subscription"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Subscription deleted successfully"})
}

// Enhanced subscription validation endpoint with user and hoster info
func validateSubscription(c *gin.Context) {
	key := c.Param("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Subscription key is required"})
		return
	}

	var subscription Subscription
	if db.Where("key = ?", key).Preload("User").Preload("User.IPTVHoster").First(&subscription).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"valid": false,
			"error": "Subscription not found",
		})
		return
	}

	// Check if subscription is still active
	now := time.Now()
	isActive := now.After(subscription.Started) && now.Before(subscription.End)

	response := gin.H{
		"valid":        isActive,
		"subscription": subscription,
		"status":       "active",
	}

	// Include user info (without sensitive data)
	if subscription.User.ID > 0 {
		userInfo := gin.H{
			"id":            subscription.User.ID,
			"name":          subscription.User.Name,
			"avatar":        subscription.User.Avatar,
			"tele_username": subscription.User.TeleUsername,
			"is_hoster":     subscription.User.IsHoster,
		}

		// Include IPTV hoster info for branding
		if subscription.User.IPTVHoster != nil {
			userInfo["iptv_hoster"] = gin.H{
				"id":            subscription.User.IPTVHoster.ID,
				"name":          subscription.User.IPTVHoster.Name,
				"logo":          subscription.User.IPTVHoster.Logo,
				"color_palette": subscription.User.IPTVHoster.ColorPalette,
			}
		}

		response["user"] = userInfo
	}

	if !isActive {
		if now.Before(subscription.Started) {
			response["status"] = "not_started"
			response["error"] = "Subscription has not started yet"
		} else {
			response["status"] = "expired"
			response["error"] = "Subscription has expired"
		}
		response["valid"] = false
	}

	c.JSON(http.StatusOK, response)
}

// Helper endpoint to add channels to a package
func addChannelToPackage(c *gin.Context) {
	packageID, _ := strconv.Atoi(c.Param("id"))
	channelID, _ := strconv.Atoi(c.Param("channelId"))

	var pkg Package
	var channel Channel

	if db.First(&pkg, packageID).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Package not found"})
		return
	}

	if db.First(&channel, channelID).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Channel not found"})
		return
	}

	db.Model(&pkg).Association("Channels").Append(&channel)
	c.JSON(http.StatusOK, gin.H{"message": "Channel added to package successfully"})
}

// Remove channel from package
func removeChannelFromPackage(c *gin.Context) {
	packageID, _ := strconv.Atoi(c.Param("id"))
	channelID, _ := strconv.Atoi(c.Param("channelId"))

	var pkg Package
	var channel Channel

	if db.First(&pkg, packageID).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Package not found"})
		return
	}

	if db.First(&channel, channelID).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Channel not found"})
		return
	}

	db.Model(&pkg).Association("Channels").Delete(&channel)
	c.JSON(http.StatusOK, gin.H{"message": "Channel removed from package successfully"})
}

// Decrypt endpoint for testing
func decryptData(c *gin.Context) {
	var req struct {
		Data string `json:"data"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	decrypted, err := decrypt(req.Data, ENCRYPTION_KEY)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Decryption failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"decrypted": decrypted})
}

func main() {
	// Initialize database
	initDB()

	// Initialize Gin router
	r := gin.Default()

	// CORS middleware to allow requests from Python web panel
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:5000", "http://127.0.0.1:5000"},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
	}))

	// API routes
	api := r.Group("/api")
	{
		// Auth endpoint
		api.POST("/login", login)

		// Public encrypted endpoints
		public := api.Group("/public")
		public.Use(encryptResponse())
		{
			public.GET("/channels", getAllChannels)
			public.GET("/packages", getAllPackages)
			public.GET("/validate/:key", validateSubscription)
		}

		// Admin endpoints with JWT auth
		admin := api.Group("/admin")
		admin.Use(jwtAuth())
		{
			// Channel management
			admin.GET("/channels", getAdminChannels)
			admin.POST("/channels", addChannel)
			admin.PUT("/channels/:id", updateChannel)
			admin.DELETE("/channels/:id", deleteChannel)

			// Package management
			admin.GET("/packages", getAdminPackages)
			admin.POST("/packages", addPackage)
			admin.PUT("/packages/:id", updatePackage)
			admin.DELETE("/packages/:id", deletePackage)
			admin.POST("/packages/:id/channels/:channelId", addChannelToPackage)
            admin.DELETE("/packages/:id/channels/:channelId", removeChannelFromPackage)

			// User management
			admin.GET("/users", getAllUsers)
			admin.GET("/users/:id", getUser)
			admin.POST("/users", addUser)
			admin.PUT("/users/:id", updateUser)
			admin.DELETE("/users/:id", deleteUser)

			// IPTV Hoster management
			admin.GET("/hosters", getAllHosters)
			admin.POST("/hosters", addHoster)
			admin.PUT("/hosters/:id", updateHoster)
			admin.DELETE("/hosters/:id", deleteHoster)

			// Subscription management
			admin.GET("/subscriptions", getAllSubscriptions)
			admin.GET("/subscriptions/:id", getSubscription)
			admin.POST("/subscriptions", addSubscription)
			admin.PUT("/subscriptions/:id", updateSubscription)
			admin.DELETE("/subscriptions/:id", deleteSubscription)
		}

		// Utility endpoint for testing decryption
		api.POST("/decrypt", decryptData)
	}

	r.Run(":65000")
}
