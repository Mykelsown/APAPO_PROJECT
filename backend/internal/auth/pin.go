package auth

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Argon2Params is the cost of hashing a PIN with argon2id.
type Argon2Params struct {
	MemoryKiB uint32
	Time      uint32
	Threads   uint8
}

// PINArgon2 is the cost used for new PIN hashes: the OWASP baseline for argon2id
// (19 MiB, 2 passes, 1 thread). Tests lower it to stay fast. Raising it later is
// safe: older hashes keep verifying and are upgraded on the next correct PIN.
var PINArgon2 = Argon2Params{MemoryKiB: 19 * 1024, Time: 2, Threads: 1}

// PBKDF2Iterations was the cost of the PBKDF2-SHA512 PIN hashes written before
// argon2id. Those hashes carry their own count, so this only matters to tests
// that make old-format hashes.
var PBKDF2Iterations = 210_000

const pinKeyLen = 32

// hashPIN returns a self describing argon2id hash:
// argon2id$v=19$m=<KiB>,t=<passes>,p=<threads>$<salt>$<hash>, base64 without padding.
func hashPIN(pin string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	p := PINArgon2
	k := argon2.IDKey([]byte(pin), salt, p.Time, p.MemoryKiB, p.Threads, pinKeyLen)
	return fmt.Sprintf("argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, p.MemoryKiB, p.Time, p.Threads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(k)), nil
}

// checkPINHash verifies argon2id hashes and the older pbkdf2 ones.
func checkPINHash(stored, pin string) bool {
	switch {
	case strings.HasPrefix(stored, "argon2id$"):
		p, salt, want, ok := parseArgon2(stored)
		if !ok {
			return false
		}
		got := argon2.IDKey([]byte(pin), salt, p.Time, p.MemoryKiB, p.Threads, uint32(len(want)))
		return subtle.ConstantTimeCompare(got, want) == 1
	case strings.HasPrefix(stored, "pbkdf2$"):
		return checkPBKDF2(stored, pin)
	}
	return false
}

// pinNeedsRehash is true for pbkdf2 hashes and for argon2id hashes made with a
// different cost than PINArgon2.
func pinNeedsRehash(stored string) bool {
	p, _, _, ok := parseArgon2(stored)
	return !ok || p != PINArgon2
}

func parseArgon2(stored string) (p Argon2Params, salt, key []byte, ok bool) {
	parts := strings.Split(stored, "$")
	if len(parts) != 5 || parts[0] != "argon2id" || parts[1] != fmt.Sprintf("v=%d", argon2.Version) {
		return p, nil, nil, false
	}
	var m, t, th uint64
	for _, kv := range strings.Split(parts[2], ",") {
		name, val, found := strings.Cut(kv, "=")
		if !found {
			return p, nil, nil, false
		}
		n, err := strconv.ParseUint(val, 10, 32)
		if err != nil {
			return p, nil, nil, false
		}
		switch name {
		case "m":
			m = n
		case "t":
			t = n
		case "p":
			th = n
		default:
			return p, nil, nil, false
		}
	}
	// Refuse silly or hostile costs rather than burn memory on a corrupted row.
	if m < 8 || m > 1<<20 || t < 1 || t > 20 || th < 1 || th > 255 {
		return p, nil, nil, false
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(parts[3])
	key, err2 := base64.RawStdEncoding.DecodeString(parts[4])
	if err1 != nil || err2 != nil || len(salt) < 8 || len(key) < 16 {
		return p, nil, nil, false
	}
	return Argon2Params{MemoryKiB: uint32(m), Time: uint32(t), Threads: uint8(th)}, salt, key, true
}

// checkPBKDF2 verifies the pbkdf2$<iterations>$<salt>$<hash> format used before argon2id.
func checkPBKDF2(stored, pin string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter < 1 || iter > 10_000_000 {
		return false
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(parts[2])
	want, err2 := base64.RawStdEncoding.DecodeString(parts[3])
	if err1 != nil || err2 != nil {
		return false
	}
	got, err := pbkdf2.Key(sha512.New, pin, salt, iter, len(want))
	return err == nil && subtle.ConstantTimeCompare(got, want) == 1
}
