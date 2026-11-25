package links

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

type PGStore struct{ DB *sql.DB }

func (s PGStore) Create(ctx context.Context, l Link) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO linked_accounts
		(id,user_id,bank_code,provider_ref,token_encrypted,consent_scope,consent_at,consent_expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		l.ID, l.UserID, l.BankCode, l.ProviderRef, l.TokenEnc, strings.Join(l.Scopes, ","), l.ConsentAt, l.ConsentExpiresAt)
	return err
}

const cols = `id,user_id,bank_code,provider_ref,token_encrypted,consent_scope,consent_at,consent_expires_at,revoked_at`

func scan(row interface{ Scan(...any) error }) (Link, error) {
	var l Link
	var scope string
	var rev sql.NullTime
	var exp sql.NullTime
	var at sql.NullTime
	err := row.Scan(&l.ID, &l.UserID, &l.BankCode, &l.ProviderRef, &l.TokenEnc, &scope, &at, &exp, &rev)
	if errors.Is(err, sql.ErrNoRows) {
		return Link{}, ErrNotFound
	}
	if scope != "" {
		l.Scopes = strings.Split(scope, ",")
	}
	l.ConsentAt, l.ConsentExpiresAt = at.Time, exp.Time
	if rev.Valid {
		t := rev.Time
		l.RevokedAt = &t
	}
	return l, err
}

func (s PGStore) ListForUser(ctx context.Context, userID string) ([]Link, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT `+cols+` FROM linked_accounts WHERE user_id=$1 ORDER BY consent_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Link
	for rows.Next() {
		l, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s PGStore) Get(ctx context.Context, userID, id string) (Link, error) {
	return scan(s.DB.QueryRowContext(ctx, `SELECT `+cols+` FROM linked_accounts WHERE id=$1 AND user_id=$2`, id, userID))
}

func (s PGStore) Revoke(ctx context.Context, userID, id string, at time.Time) error {
	res, err := s.DB.ExecContext(ctx, `UPDATE linked_accounts SET revoked_at=$3, token_encrypted=NULL WHERE id=$1 AND user_id=$2`, id, userID, at)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
