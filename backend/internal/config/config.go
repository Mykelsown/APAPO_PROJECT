// Package config reads settings from the environment. Secrets never live in code.
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr        string
	DatabaseURL string
	Provider    string // "mock" or "real"
	// AppSecret keys hashes of codes and BVNs. Set a long random value outside development.
	AppSecret string
	// EncryptionKey is a base64 32 byte key for provider tokens at rest.
	EncryptionKey string
	// DevOTP, when set, is the code every OTP request uses. Never set it in production.
	DevOTP     string
	DemoPhone  string
	DemoPhone2 string
	// BankAPIURL and BankAPIKey are used when PROVIDER=real.
	BankAPIURL string
	BankAPIKey string
	// ScanInterval is how often incoming credits are checked. Zero turns the timer off.
	ScanInterval time.Duration
	// AllowedOrigin is the frontend's origin, for example https://app.example.com. Empty means no CORS.
	AllowedOrigin string
	// TrustProxy reads client IPs from X-Forwarded-For. Only behind a proxy you control.
	TrustProxy bool
}

func Load() Config {
	return Config{
		Addr:          get("ADDR", ":8080"),
		DatabaseURL:   os.Getenv("DATABASE_URL"),
		Provider:      get("PROVIDER", "mock"),
		AppSecret:     get("APP_SECRET", "dev-only-secret-change-me"),
		EncryptionKey: os.Getenv("ENCRYPTION_KEY"),
		DevOTP:        os.Getenv("DEV_OTP"),
		DemoPhone:     get("DEMO_PHONE", "+2348012345678"),
		DemoPhone2:    get("DEMO_PHONE_2", "+2348098765432"),
		BankAPIURL:    os.Getenv("BANK_API_URL"),
		BankAPIKey:    os.Getenv("BANK_API_KEY"),
		ScanInterval:  scanInterval(),
		AllowedOrigin: strings.TrimRight(os.Getenv("ALLOWED_ORIGIN"), "/"),
		TrustProxy:    os.Getenv("TRUST_PROXY") == "true",
	}
}

func scanInterval() time.Duration {
	if v := os.Getenv("SCAN_INTERVAL_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			return time.Duration(n) * time.Second
		}
	}
	return 10 * time.Second
}

func get(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
