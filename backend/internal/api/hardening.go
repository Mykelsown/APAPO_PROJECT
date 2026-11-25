package api

import (
	"context"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Defaults for the hardening middleware. Deps can override them.
const (
	DefaultRequestTimeout = 30 * time.Second
	// Auth endpoints allow a burst of 20 requests per client IP, refilled at 30 a minute.
	DefaultAuthBurst     = 20
	DefaultAuthPerMinute = 30
	LookupBurst          = 10
	LookupPerMinute      = 30
)

// withCORS lets exactly one browser origin (the frontend) call the API. With no
// origin configured no cross-origin access is granted at all. Bearer tokens are
// sent in a header, never in cookies, so credentials mode is not needed.
func withCORS(allowed string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		w.Header().Add("Vary", "Origin")
		ok := origin != "" && allowed != "" && origin == allowed
		preflight := r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != ""
		if ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		if preflight {
			if !ok {
				writeError(w, http.StatusForbidden, "origin_not_allowed", "This origin may not call the API.", nil)
				return
			}
			h := w.Header()
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key")
			h.Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// withTimeout gives every request a deadline. Bank calls and database queries use
// the request context, so they stop when it passes. Background payment work runs
// on its own context and is not cut short.
func withTimeout(d time.Duration, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), d)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// ipLimiter is a token bucket per client IP.
type ipLimiter struct {
	mu        sync.Mutex
	burst     float64
	perSecond float64
	buckets   map[string]*bucket
	now       func() time.Time
	lastSweep time.Time
}

type bucket struct {
	tokens float64
	seen   time.Time
}

func newIPLimiter(burst, perMinute int) *ipLimiter {
	return &ipLimiter{burst: float64(burst), perSecond: float64(perMinute) / 60, buckets: map[string]*bucket{}, now: time.Now}
}

// take spends one token. When none is left it returns how long until the next one.
func (l *ipLimiter) take(ip string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	// Forget clients that have been quiet long enough to be full again.
	if now.Sub(l.lastSweep) > time.Minute {
		full := time.Duration(l.burst/l.perSecond*float64(time.Second)) + time.Minute
		for k, b := range l.buckets {
			if now.Sub(b.seen) > full {
				delete(l.buckets, k)
			}
		}
		l.lastSweep = now
	}
	b := l.buckets[ip]
	if b == nil {
		b = &bucket{tokens: l.burst, seen: now}
		l.buckets[ip] = b
	}
	b.tokens = math.Min(l.burst, b.tokens+now.Sub(b.seen).Seconds()*l.perSecond)
	b.seen = now
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	return false, time.Duration((1 - b.tokens) / l.perSecond * float64(time.Second))
}

// withAuthRateLimit caps requests per client IP on /api/auth/. It sits on top of
// the per-phone OTP limits, which stop one phone being flooded; this stops one
// client trying many phones or PINs.
func withAuthRateLimit(l *ipLimiter, trustProxy bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/auth/") {
			next.ServeHTTP(w, r)
			return
		}
		ok, wait := l.take(clientIP(r, trustProxy))
		if !ok {
			secs := int(math.Ceil(wait.Seconds()))
			w.Header().Set("Retry-After", strconv.Itoa(secs))
			writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many attempts. Try again shortly.", map[string]any{"retry_after_seconds": secs})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func withLookupRateLimit(l *ipLimiter, trustProxy bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/users/lookup" {
			next.ServeHTTP(w, r)
			return
		}
		ok, wait := l.take(clientIP(r, trustProxy))
		if !ok {
			secs := int(math.Ceil(wait.Seconds()))
			w.Header().Set("Retry-After", strconv.Itoa(secs))
			writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many lookup requests. Try again shortly.", map[string]any{"retry_after_seconds": secs})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// clientIP is the connecting address. Behind a proxy (trustProxy) it is the last
// X-Forwarded-For entry, the one our own proxy added; earlier entries are written
// by the client and cannot be trusted.
func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
				return ip
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
