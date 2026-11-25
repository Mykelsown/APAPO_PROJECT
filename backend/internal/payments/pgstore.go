package payments

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"time"
)

type PGStore struct{ DB *sql.DB }

func (s PGStore) Create(ctx context.Context, p *Payment) (*Payment, bool, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()
	rec, _ := json.Marshal(p.Recipient)
	res, err := tx.ExecContext(ctx, `INSERT INTO transfers
		(id,user_id,idempotency_key,state,amount_kobo,fee_kobo,recipient,message,created_at,updated_at,reversal_attempts,next_reversal_retry,last_reversal_attempt,human_review)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,0,NULL,NULL,false)
		ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
		p.ID, p.UserID, p.IdempotencyKey, p.State, p.AmountKobo, p.FeeKobo, rec, p.Message, p.CreatedAt)
	if err != nil {
		return nil, false, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		tx.Rollback()
		ex, err := s.GetByKey(ctx, p.UserID, p.IdempotencyKey)
		return ex, false, err
	}
	for _, l := range p.Legs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO transfer_legs
			(id,transfer_id,account_id,bank_code,amount_kobo,fee_kobo,state,provider_ref,error,position,updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			l.ID, p.ID, l.AccountID, l.BankCode, l.AmountKobo, l.FeeKobo, l.State, nullable(l.ProviderRef), l.Error, l.Position, p.CreatedAt); err != nil {
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

func (s PGStore) Get(ctx context.Context, userID, id string) (*Payment, error) {
	return s.load(ctx, `WHERE id=$1 AND user_id=$2`, id, userID)
}

func (s PGStore) GetByKey(ctx context.Context, userID, key string) (*Payment, error) {
	return s.load(ctx, `WHERE user_id=$1 AND idempotency_key=$2`, userID, key)
}

func (s PGStore) Unfinished(ctx context.Context) ([]*Payment, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id FROM transfers WHERE state='needs_attention' ORDER BY updated_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var out []*Payment
	for _, id := range ids {
		p, err := s.load(ctx, `WHERE id=$1`, id)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

func (s PGStore) load(ctx context.Context, where string, args ...any) (*Payment, error) {
	var p Payment
	var rec []byte
	var nextRetry, lastAttempt sql.NullTime
	err := s.DB.QueryRowContext(ctx, `SELECT id,user_id,idempotency_key,state,amount_kobo,fee_kobo,recipient,message,created_at,updated_at,reversal_attempts,next_reversal_retry,last_reversal_attempt,human_review FROM transfers `+where, args...).
		Scan(&p.ID, &p.UserID, &p.IdempotencyKey, &p.State, &p.AmountKobo, &p.FeeKobo, &rec, &p.Message, &p.CreatedAt, &p.UpdatedAt, &p.ReversalAttempts, &nextRetry, &lastAttempt, &p.HumanReview)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	json.Unmarshal(rec, &p.Recipient)
	if nextRetry.Valid {
		t := nextRetry.Time
		p.NextReversalRetry = &t
	}
	if lastAttempt.Valid {
		t := lastAttempt.Time
		p.LastReversalAttempt = &t
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT id,account_id,bank_code,amount_kobo,fee_kobo,state,COALESCE(provider_ref,''),error,position,updated_at FROM transfer_legs WHERE transfer_id=$1 ORDER BY position`, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var l Leg
		if err := rows.Scan(&l.ID, &l.AccountID, &l.BankCode, &l.AmountKobo, &l.FeeKobo, &l.State, &l.ProviderRef, &l.Error, &l.Position, &l.UpdatedAt); err != nil {
			return nil, err
		}
		p.Legs = append(p.Legs, l)
	}
	return &p, rows.Err()
}

func (s PGStore) Update(ctx context.Context, p *Payment) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE transfers SET state=$2, message=$3, updated_at=$4, reversal_attempts=$5, next_reversal_retry=$6, last_reversal_attempt=$7, human_review=$8 WHERE id=$1`,
		p.ID, p.State, p.Message, p.UpdatedAt, p.ReversalAttempts, p.NextReversalRetry, p.LastReversalAttempt, p.HumanReview); err != nil {
		return err
	}
	for _, l := range p.Legs {
		if _, err := tx.ExecContext(ctx, `UPDATE transfer_legs SET state=$2, provider_ref=$3, error=$4, updated_at=$5 WHERE id=$1`,
			l.ID, l.State, nullable(l.ProviderRef), l.Error, l.UpdatedAt); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s PGStore) Audit(ctx context.Context, e AuditEntry) error {
	d, _ := json.Marshal(e.Detail)
	_, err := s.DB.ExecContext(ctx, `INSERT INTO audit_log (user_id,event,subject_id,detail,at) VALUES (NULLIF($1,''),$2,$3,$4,$5)`,
		e.UserID, e.Event, e.SubjectID, d, e.At)
	return err
}

func (s PGStore) Recent(ctx context.Context, userID string, limit int) ([]*Payment, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id,state,amount_kobo,recipient,created_at FROM transfers WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Payment
	for rows.Next() {
		p := &Payment{UserID: userID}
		var rec []byte
		if err := rows.Scan(&p.ID, &p.State, &p.AmountKobo, &rec, &p.CreatedAt); err != nil {
			return nil, err
		}
		json.Unmarshal(rec, &p.Recipient)
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s PGStore) ListSent(ctx context.Context, userID string, limit int, beforeID string) ([]*Payment, error) {
	q := `SELECT id,state,amount_kobo,recipient,created_at FROM transfers WHERE user_id=$1`
	args := []any{userID}
	if beforeID != "" {
		var beforeTime time.Time
		if err := s.DB.QueryRowContext(ctx, `SELECT created_at FROM transfers WHERE id=$1 AND user_id=$2`, beforeID, userID).Scan(&beforeTime); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return []*Payment{}, nil
			}
			return nil, err
		}
		q += ` AND (created_at < $2 OR (created_at = $2 AND id < $3))`
		args = append(args, beforeTime, beforeID)
	}
	q += ` ORDER BY created_at DESC, id DESC LIMIT $` + strconv.Itoa(len(args)+1)
	args = append(args, limit)
	rows, err := s.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Payment
	for rows.Next() {
		var p Payment
		var rec []byte
		if err := rows.Scan(&p.ID, &p.State, &p.AmountKobo, &rec, &p.CreatedAt); err != nil {
			return nil, err
		}
		p.UserID = userID
		json.Unmarshal(rec, &p.Recipient)
		out = append(out, &p)
	}
	return out, rows.Err()
}
