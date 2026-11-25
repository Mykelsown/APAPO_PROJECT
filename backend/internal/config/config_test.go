package config

import "testing"

func TestDefaultsAndOverrides(t *testing.T) {
	t.Setenv("ADDR", "")
	t.Setenv("PROVIDER", "")
	t.Setenv("DEMO_PHONE_2", "")
	c := Load()
	if c.Addr != ":8080" || c.Provider != "mock" {
		t.Fatalf("defaults wrong: %+v", c)
	}
	if c.DemoPhone2 != "+2348098765432" {
		t.Fatalf("second demo phone wrong: %+v", c)
	}
	t.Setenv("PROVIDER", "real")
	if Load().Provider != "real" {
		t.Fatal("override ignored")
	}
}

func TestBankAndScanSettingsAreRead(t *testing.T) {
	t.Setenv("BANK_API_URL", "https://bank.example")
	t.Setenv("BANK_API_KEY", "k")
	t.Setenv("SCAN_INTERVAL_SECONDS", "0")
	c := Load()
	if c.BankAPIURL != "https://bank.example" || c.BankAPIKey != "k" || c.ScanInterval != 0 {
		t.Fatalf("%+v", c)
	}
	t.Setenv("SCAN_INTERVAL_SECONDS", "")
	if Load().ScanInterval.Seconds() != 10 {
		t.Fatal("default scan interval")
	}
}
