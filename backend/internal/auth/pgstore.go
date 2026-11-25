package auth

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type PGStore struct{ DB *sql.DB }

const userCols = `id, phone, COALESCE(display_name,''), COALESCE(receiving_account_id,''), COALESCE(bvn_hash,''), COALESCE(pin_hash,''), pin_failed, pin_locked_until, created_at`

func scanUser(row interface{ Scan(...any) error }) (User, error) {
	var u User
	var locked sql.NullTime
	err := row.Scan(&u.ID, &u.Phone, &u.DisplayName, &u.ReceivingAccountID, &u.BVNHash, &u.PINHash, &u.PINFailed, &locked, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
	if locked.Valid {
		t := locked.Time
		u.PINLockedUntil = &t
	}
	return u, err
}

func (s PGStore) UpsertUserByPhone(ctx context.Context, id, phone string, now time.Time) (User, error) {
	if _, err := s.DB.ExecContext(ctx, `INSERT INTO users (id, phone, created_at) VALUES ($1,$2,$3) ON CONFLICT (phone) DO NOTHING`, id, phone, now); err != nil {
		return User{}, err
	}
	return s.GetUserByPhone(ctx, phone)
}

func (s PGStore) GetUser(ctx context.Context, id string) (User, error) {
	return scanUser(s.DB.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE id=$1`, id))
}

func (s PGStore) GetUserByPhone(ctx context.Context, phone string) (User, error) {
	return scanUser(s.DB.QueryRowContext(ctx, `SELECT `+userCols+` FROM users WHERE phone=$1`, phone))
}

func nul(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s PGStore) UpdateUser(ctx context.Context, u User) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE users SET display_name=$2, receiving_account_id=$3, bvn_hash=$4, pin_hash=$5, pin_failed=$6, pin_locked_until=$7 WHERE id=$1`,
		u.ID, nul(u.DisplayName), nul(u.ReceivingAccountID), nul(u.BVNHash), nul(u.PINHash), u.PINFailed, u.PINLockedUntil)
	return err
}

func (s PGStore) GetOTP(ctx context.Context, phone string) (OTP, bool, error) {
	var o OTP
	err := s.DB.QueryRowContext(ctx, `SELECT phone, code_hash, expires_at, attempts, sent_count, window_start FROM otp_codes WHERE phone=$1`, phone).
		Scan(&o.Phone, &o.CodeHash, &o.ExpiresAt, &o.Attempts, &o.SentCount, &o.WindowStart)
	if errors.Is(err, sql.ErrNoRows) {
		return OTP{}, false, nil
	}
	return o, err == nil, err
}

func (s PGStore) PutOTP(ctx context.Context, o OTP) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO otp_codes (phone, code_hash, expires_at, attempts, sent_count, window_start)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (phone) DO UPDATE SET code_hash=$2, expires_at=$3, attempts=$4, sent_count=$5, window_start=$6`,
		o.Phone, o.CodeHash, o.ExpiresAt, o.Attempts, o.SentCount, o.WindowStart)
	return err
}

func (s PGStore) DeleteOTP(ctx context.Context, phone string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM otp_codes WHERE phone=$1`, phone)
	return err
}

func (s PGStore) PutSession(ctx context.Context, x Session) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO sessions (id,user_id,access_hash,access_expires,refresh_hash,refresh_expires)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (id) DO UPDATE SET access_hash=$3, access_expires=$4, refresh_hash=$5, refresh_expires=$6`,
		x.ID, x.UserID, x.AccessHash, x.AccessExpires, x.RefreshHash, x.RefreshExpires)
	return err
}

func (s PGStore) session(ctx context.Context, col, h string) (Session, error) {
	var x Session
	var rev sql.NullTime
	err := s.DB.QueryRowContext(ctx, `SELECT id,user_id,access_hash,access_expires,refresh_hash,refresh_expires,revoked_at FROM sessions WHERE `+col+`=$1`, h).
		Scan(&x.ID, &x.UserID, &x.AccessHash, &x.AccessExpires, &x.RefreshHash, &x.RefreshExpires, &rev)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, ErrInvalidToken
	}
	if rev.Valid {
		t := rev.Time
		x.RevokedAt = &t
	}
	return x, err
}

func (s PGStore) GetSessionByAccessHash(ctx context.Context, h string) (Session, error) {
	return s.session(ctx, "access_hash", h)
}

func (s PGStore) GetSessionByRefreshHash(ctx context.Context, h string) (Session, error) {
	return s.session(ctx, "refresh_hash", h)
}

func (s PGStore) RevokeSession(ctx context.Context, id string, at time.Time) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE sessions SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL`, id, at)
	return err
}

func (s PGStore) RevokeUserSessions(ctx context.Context, userID string, at time.Time) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE sessions SET revoked_at=$2 WHERE user_id=$1 AND revoked_at IS NULL`, userID, at)
	return err
}

func (s PGStore) ListSessions(ctx context.Context, userID string, now time.Time) ([]Session, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id,user_id,access_expires,refresh_expires FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND refresh_expires>$2 ORDER BY refresh_expires DESC`, userID, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Session
	for rows.Next() {
		var x Session
		if err := rows.Scan(&x.ID, &x.UserID, &x.AccessExpires, &x.RefreshExpires); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
