package secrets

import (
	"bytes"
	"testing"
)

func TestRoundTripAndTamper(t *testing.T) {
	b, _ := New(bytes.Repeat([]byte{7}, 32))
	enc := b.Encrypt([]byte("tok_abc"))
	if bytes.Contains(enc, []byte("tok_abc")) {
		t.Fatal("plaintext visible in ciphertext")
	}
	got, err := b.Decrypt(enc)
	if err != nil || string(got) != "tok_abc" {
		t.Fatalf("%v %s", err, got)
	}
	enc[len(enc)-1] ^= 1
	if _, err := b.Decrypt(enc); err == nil {
		t.Fatal("tampered ciphertext accepted")
	}
	if b2 := b.Encrypt([]byte("x")); bytes.Equal(b2, b.Encrypt([]byte("x"))) {
		t.Fatal("nonce reused")
	}
}

func TestKeyChecks(t *testing.T) {
	if _, err := New([]byte("short")); err == nil {
		t.Fatal("short key accepted")
	}
	if _, derived, err := FromEnv("", "s"); err != nil || !derived {
		t.Fatal("dev fallback broken")
	}
	if _, _, err := FromEnv("!!notbase64", "s"); err == nil {
		t.Fatal("bad base64 accepted")
	}
}
