// Package secrets encrypts small values (provider tokens) at rest with AES-256-GCM.
package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
)

type Box struct{ gcm cipher.AEAD }

// New takes a 32 byte key.
func New(key []byte) (*Box, error) {
	if len(key) != 32 {
		return nil, errors.New("secrets: key must be 32 bytes")
	}
	blk, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	g, err := cipher.NewGCM(blk)
	return &Box{gcm: g}, err
}

// FromEnv reads a base64 key. When empty it derives a development key from the fallback
// secret, so local runs work; production must set a real key.
func FromEnv(b64, fallbackSecret string) (box *Box, derived bool, err error) {
	if b64 == "" {
		sum := sha256.Sum256([]byte("apapo-enc|" + fallbackSecret))
		box, err = New(sum[:])
		return box, true, err
	}
	key, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, false, errors.New("secrets: ENCRYPTION_KEY must be base64")
	}
	box, err = New(key)
	return box, false, err
}

func (b *Box) Encrypt(plain []byte) []byte {
	nonce := make([]byte, b.gcm.NonceSize())
	rand.Read(nonce)
	return b.gcm.Seal(nonce, nonce, plain, nil)
}

func (b *Box) Decrypt(blob []byte) ([]byte, error) {
	n := b.gcm.NonceSize()
	if len(blob) < n {
		return nil, errors.New("secrets: ciphertext too short")
	}
	return b.gcm.Open(nil, blob[:n], blob[n:], nil)
}
