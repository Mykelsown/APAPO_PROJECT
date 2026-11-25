package splitreceive

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

type PGStore struct{ DB *sql.DB }

func (s PGStore) GetRules(ctx context.Context, userID string) (Rules, bool, error) {
	var r Rules
	var dests []byte
	var rev sql.NullTime
	err := s.DB.QueryRowContext(ctx, `SELECT user_id, receiving_account_id, destinations, consent_at, revoked_at, updated_at FROM split_receive_rules WHERE user_id=$1`, userID).
		Scan(&r.UserID, &r.ReceivingAccountID, &dests, &r.ConsentAt, &rev, &r.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Rules{}, false, nil
	}
	if err != nil {
		return Rules{}, false, err
	}
	json.Unmarshal(dests, &r.Destinations)
	if rev.Valid {
		t := rev.Time
		r.RevokedAt = &t
	}
	return r, true, nil
}

func (s PGStore) PutRules(ctx context.Context, r Rules) error {
	d, _ := json.Marshal(r.Destinations)
	_, err := s.DB.ExecContext(ctx, `INSERT INTO split_receive_rules (user_id, receiving_account_id, destinations, consent_at, revoked_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (user_id) DO UPDATE SET receiving_account_id=$2, destinations=$3, consent_at=$4, revoked_at=$5, updated_at=$6`,
		r.UserID, r.ReceivingAccountID, d, r.ConsentAt, r.RevokedAt, r.UpdatedAt)
	return err
}

func (s PGStore) ActiveUsers(ctx context.Context) ([]string, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT user_id FROM split_receive_rules WHERE revoked_at IS NULL ORDER BY user_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s PGStore) CreateRun(ctx context.Context, r *Run) (*Run, bool, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `INSERT INTO split_receive_runs (id,user_id,credit_id,account_id,amount_kobo,received_at,state,message,created_at,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) ON CONFLICT (user_id, credit_id) DO NOTHING`,
		r.ID, r.UserID, r.CreditID, r.AccountID, r.AmountKobo, r.ReceivedAt, r.State, r.Message, r.CreatedAt)
	if err != nil {
		return nil, false, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		tx.Rollback()
		ex, err := s.load(ctx, `WHERE user_id=$1 AND credit_id=$2`, r.UserID, r.CreditID)
		return ex, false, err
	}
	for _, l := range r.Legs {
		d, _ := json.Marshal(l.Dest)
		if _, err := tx.ExecContext(ctx, `INSERT INTO split_receive_legs (id,run_id,position,destination,amount_kobo,fee_kobo,state,provider_ref,error,updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, l.ID, r.ID, l.Position, d, l.AmountKobo, l.FeeKobo, l.State, nullable(l.ProviderRef), l.Error, r.CreatedAt); err != nil {
			return nil, false, err
		}
	}
	return nil, true, tx.Commit()
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s PGStore) load(ctx context.Context, where string, args ...any) (*Run, error) {
	var r Run
	err := s.DB.QueryRowContext(ctx, `SELECT id,user_id,credit_id,account_id,amount_kobo,received_at,state,message,created_at,updated_at FROM split_receive_runs `+where, args...).
		Scan(&r.ID, &r.UserID, &r.CreditID, &r.AccountID, &r.AmountKobo, &r.ReceivedAt, &r.State, &r.Message, &r.CreatedAt, &r.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrRunNotFound
	}
	if err != nil {
		return nil, err
	}
	return &r, s.loadLegs(ctx, &r)
}

func (s PGStore) loadLegs(ctx context.Context, r *Run) error {
	rows, err := s.DB.QueryContext(ctx, `SELECT id,position,destination,amount_kobo,fee_kobo,state,COALESCE(provider_ref,''),error,updated_at FROM split_receive_legs WHERE run_id=$1 ORDER BY position`, r.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var l Leg
		var d []byte
		if err := rows.Scan(&l.ID, &l.Position, &d, &l.AmountKobo, &l.FeeKobo, &l.State, &l.ProviderRef, &l.Error, &l.UpdatedAt); err != nil {
			return err
		}
		json.Unmarshal(d, &l.Dest)
		r.Legs = append(r.Legs, l)
	}
	return rows.Err()
}

func (s PGStore) GetRun(ctx context.Context, userID, id string) (*Run, error) {
	return s.load(ctx, `WHERE id=$1 AND user_id=$2`, id, userID)
}

func (s PGStore) UpdateRun(ctx context.Context, r *Run) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE split_receive_runs SET state=$2, message=$3, updated_at=$4 WHERE id=$1`, r.ID, r.State, r.Message, r.UpdatedAt); err != nil {
		return err
	}
	for _, l := range r.Legs {
		if _, err := tx.ExecContext(ctx, `UPDATE split_receive_legs SET state=$2, provider_ref=$3, error=$4, fee_kobo=$5, updated_at=$6 WHERE id=$1`,
			l.ID, l.State, nullable(l.ProviderRef), l.Error, l.FeeKobo, l.UpdatedAt); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s PGStore) ListRuns(ctx context.Context, userID string, from, to time.Time, limit int) ([]*Run, error) {
	q := `SELECT id FROM split_receive_runs WHERE user_id=$1`
	args := []any{userID}
	if !from.IsZero() {
		args = append(args, from)
		q += ` AND received_at >= $` + itoa(len(args))
	}
	if !to.IsZero() {
		args = append(args, to)
		q += ` AND received_at < $` + itoa(len(args))
	}
	q += ` ORDER BY received_at DESC, id DESC`
	if limit > 0 {
		q += ` LIMIT ` + itoa(limit)
	}
	return s.runsFromIDs(ctx, q, args...)
}

func (s PGStore) RunsInState(ctx context.Context, userID string, state RunState) ([]*Run, error) {
	return s.runsFromIDs(ctx, `SELECT id FROM split_receive_runs WHERE user_id=$1 AND state=$2 ORDER BY received_at`, userID, state)
}

func (s PGStore) runsFromIDs(ctx context.Context, q string, args ...any) ([]*Run, error) {
	rows, err := s.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	var out []*Run
	for _, id := range ids {
		r, err := s.load(ctx, `WHERE id=$1`, id)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, nil
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}
