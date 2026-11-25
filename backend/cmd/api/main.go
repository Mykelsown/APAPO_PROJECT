package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/Mykelsown/apapo/backend/internal/api"
	"github.com/Mykelsown/apapo/backend/internal/audit"
	"github.com/Mykelsown/apapo/backend/internal/auth"
	"github.com/Mykelsown/apapo/backend/internal/bank"
	"github.com/Mykelsown/apapo/backend/internal/bank/mock"
	"github.com/Mykelsown/apapo/backend/internal/bank/real"
	"github.com/Mykelsown/apapo/backend/internal/categorize"
	"github.com/Mykelsown/apapo/backend/internal/config"
	"github.com/Mykelsown/apapo/backend/internal/db"
	"github.com/Mykelsown/apapo/backend/internal/limits"
	"github.com/Mykelsown/apapo/backend/internal/links"
	"github.com/Mykelsown/apapo/backend/internal/payments"
	"github.com/Mykelsown/apapo/backend/internal/safesend"
	"github.com/Mykelsown/apapo/backend/internal/secrets"
	"github.com/Mykelsown/apapo/backend/internal/splitreceive"
)

// providers holds everything that depends on PROVIDER=mock or real.
type providers struct {
	bank    bank.Provider
	linker  bank.Linker
	catalog []bank.BankInfo
	mock    *mock.Provider // set only in mock mode; enables the demo routes
}

func newProviders(cfg config.Config) providers {
	switch cfg.Provider {
	case "mock":
		p := mock.New(nil)
		mock.Seed(p)
		mock.SeedUnverifiedCredit(p)
		return providers{bank: p, linker: p, catalog: mock.Catalog(), mock: p}
	case "real":
		p, err := real.New(real.Config{
			BaseURL: cfg.BankAPIURL, APIKey: cfg.BankAPIKey, ReadRetries: 2,
			Banks: []bank.BankInfo{{Code: "examplebank", Name: "Example Bank", Supported: true}},
		})
		if err != nil {
			log.Fatalf("real provider: %v", err)
		}
		return providers{bank: p, linker: p, catalog: p.Catalog()}
	}
	log.Fatalf("PROVIDER must be mock or real, got %q", cfg.Provider)
	return providers{}
}

func newExecutor(p bank.Provider, s payments.Store, a audit.Logger) *payments.Executor {
	ex := payments.NewExecutor(p, s)
	ex.Logger = a
	return ex
}

func main() {
	cfg := config.Load()
	if cfg.Provider == "real" && (cfg.AppSecret == "dev-only-secret-change-me" || cfg.DevOTP != "") {
		log.Fatal("refusing to start with PROVIDER=real and the default APP_SECRET or DEV_OTP set")
	}
	prov := newProviders(cfg)
	var store payments.Store = payments.NewMemoryStore()
	var authStore auth.Store = auth.NewMemoryStore()
	var pgdb *sql.DB
	if cfg.DatabaseURL != "" {
		d, err := db.Open(cfg.DatabaseURL)
		if err != nil {
			log.Fatalf("database: %v", err)
		}
		defer d.Close()
		pgdb = d
		if err := db.Migrate(context.Background(), d); err != nil {
			log.Fatalf("migrate: %v", err)
		}
		log.Println("migrations applied")
		store = payments.PGStore{DB: d}
		authStore = auth.PGStore{DB: d}
	} else {
		log.Println("DATABASE_URL not set, running without a database")
	}
	box, derived, err := secrets.FromEnv(cfg.EncryptionKey, cfg.AppSecret)
	if err != nil {
		log.Fatalf("encryption key: %v", err)
	}
	if derived {
		log.Println("ENCRYPTION_KEY not set: using a development key. Set a real 32 byte key outside development.")
	}
	var linkStore links.Store = links.NewMemoryStore()
	var auditLog audit.Logger = audit.NewMemory()
	if pgdb != nil {
		linkStore, auditLog = links.PGStore{DB: pgdb}, audit.PG{DB: pgdb}
	}
	var catStore categorize.Store = categorize.NewMemoryStore()
	if pgdb != nil {
		catStore = categorize.PGStore{DB: pgdb}
	}
	linkSvc := &links.Service{Store: linkStore, Linker: prov.linker, Catalog: prov.catalog, Box: box, Audit: auditLog, Now: time.Now}
	var limStore limits.Store = limits.NewMemoryStore()
	var limLock limits.Locker = limits.NewMemoryLocker()
	if pgdb != nil {
		limStore, limLock = limits.PGStore{DB: pgdb}, limits.NewPGLocker(pgdb)
	}
	var srSvc *splitreceive.Service
	limSvc := &limits.Service{Store: limStore, Locker: limLock, Now: time.Now, Sources: []limits.Spent{
		// Split-Pay: everything not rolled back counts, including payments still in flight.
		func(ctx context.Context, userID string, since time.Time) (int64, error) {
			recent, err := store.Recent(ctx, userID, 500)
			if err != nil {
				return 0, err
			}
			var sum int64
			for _, p := range recent {
				if !p.CreatedAt.Before(since) && p.State != payments.StateRolledBack {
					sum += p.AmountKobo
				}
			}
			return sum, nil
		},
		// Split-Receive: shares already sent today.
		func(ctx context.Context, userID string, since time.Time) (int64, error) {
			runs, err := srSvc.Runs(ctx, userID, 200)
			if err != nil {
				return 0, err
			}
			var sum int64
			for _, run := range runs {
				for _, l := range run.Legs {
					if l.State == splitreceive.LegCollected && !l.UpdatedAt.Before(since) {
						sum += l.AmountKobo
					}
				}
			}
			return sum, nil
		},
	}}
	srStore := splitreceive.Store(splitreceive.NewMemoryStore())
	if pgdb != nil {
		srStore = splitreceive.PGStore{DB: pgdb}
	}
	srSvc = &splitreceive.Service{Limits: limSvc,
		Store: srStore, Provider: prov.bank, Audit: auditLog, Now: time.Now, RetryDelay: 150 * time.Millisecond,
		Fee: func(string) int64 { return 1000 },
		Accounts: func(ctx context.Context, userID string) ([]bank.Account, error) {
			active, err := linkSvc.Active(ctx, userID)
			if err != nil {
				return nil, err
			}
			var out []bank.Account
			for _, l := range active {
				if a, err := prov.linker.AccountsAt(ctx, userID, l.BankCode); err == nil {
					out = append(out, a...)
				}
			}
			return out, nil
		},
	}
	var ssStore safesend.Store = safesend.NewMemoryStore()
	if pgdb != nil {
		ssStore = safesend.PGStore{DB: pgdb}
	}
	ssSvc := &safesend.Service{Store: ssStore, Salt: []byte(cfg.AppSecret), Now: time.Now}
	if prov.mock != nil {
		ssSvc.ResolveName = prov.mock.ResolveName
		for _, r := range mock.DemoRecipients {
			if r.Kind == "flagged" {
				ssSvc.SeedFlagged(context.Background(), safesend.Recipient{BankCode: r.BankCode, AccountNumber: r.AccountNumber})
			}
		}
	}
	authSvc := auth.New(authStore, []byte(cfg.AppSecret))
	authSvc.FixedOTP, authSvc.DemoPhone, authSvc.DemoUserID = cfg.DevOTP, cfg.DemoPhone, mock.DemoUserID
	authSvc.DemoPhone2, authSvc.DemoUserID2 = cfg.DemoPhone2, mock.DemoUserID2
	if cfg.Provider == "mock" {
		if u, err := authStore.UpsertUserByPhone(context.Background(), mock.DemoUserID2, cfg.DemoPhone2, time.Now().UTC()); err == nil {
			u.DisplayName = "Bola Adeyemi"
			u.ReceivingAccountID = "acc_demo2_apex_1"
			_ = authStore.UpdateUser(context.Background(), u)
			_ = authSvc.VerifyBVN(context.Background(), u.ID, "22222222222")
			_ = authSvc.SetPIN(context.Background(), u.ID, "5912")
			_, _ = linkSvc.Link(context.Background(), u.ID, "apex", []string{"accounts", "balances", "transactions"})
		}
	}
	if cfg.DevOTP != "" {
		log.Printf("DEV_OTP is set: every sign in code is %s. Do not use this outside development.", cfg.DevOTP)
	}
	log.Print(startupSummary(cfg))
	paymentExecutor := newExecutor(prov.bank, store, auditLog)
	if err := paymentExecutor.RescanUnfinished(context.Background()); err != nil {
		log.Printf("reversal startup rescan failed: %v", err)
	}
	srv := &http.Server{Addr: cfg.Addr, Handler: api.New(api.Deps{Provider: prov.bank, Executor: paymentExecutor, Limits: limSvc, Store: store, Mock: prov.mock, Auth: authSvc, Linker: prov.linker, Links: linkSvc, SplitReceive: srSvc, SafeSend: ssSvc, Categories: &categorize.Service{Store: catStore, Now: time.Now}, Audit: auditLog,
		AllowedOrigin: cfg.AllowedOrigin, TrustProxy: cfg.TrustProxy}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		// Longer than the per-request deadline, so a slow handler still gets to write its error.
		WriteTimeout: api.DefaultRequestTimeout + 15*time.Second,
		IdleTimeout:  2 * time.Minute,
	}
	// Look for new incoming credits on a timer. SCAN_INTERVAL=0 turns this off.
	scanCtx, stopScan := context.WithCancel(context.Background())
	defer stopScan()
	reversalCtx, stopReversal := context.WithCancel(context.Background())
	defer stopReversal()
	go func() {
		t := time.NewTicker(10 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				if err := paymentExecutor.RescanUnfinished(reversalCtx); err != nil {
					log.Printf("reversal retry rescan failed: %v", err)
				}
			case <-reversalCtx.Done():
				return
			}
		}
	}()
	if cfg.ScanInterval > 0 {
		go func() {
			t := time.NewTicker(cfg.ScanInterval)
			defer t.Stop()
			for {
				select {
				case <-t.C:
					srSvc.ScanAll(scanCtx)
				case <-scanCtx.Done():
					return
				}
			}
		}()
	}
	go func() {
		log.Printf("apapo api listening on %s (provider=%s)", cfg.Addr, cfg.Provider)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}

// startupSummary says how the server is set up, without any secret values.
func startupSummary(cfg config.Config) string {
	onOff := func(b bool) string {
		if b {
			return "on"
		}
		return "off"
	}
	origin := cfg.AllowedOrigin
	if origin == "" {
		origin = "none"
	}
	return fmt.Sprintf("config: provider=%s database=%s dev_otp=%s allowed_origin=%s trust_proxy=%s encryption_key=%s scan_interval=%s",
		cfg.Provider, onOff(cfg.DatabaseURL != ""), onOff(cfg.DevOTP != ""), origin, onOff(cfg.TrustProxy),
		map[bool]string{true: "set", false: "derived (dev)"}[cfg.EncryptionKey != ""], cfg.ScanInterval)
}
