# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Nigerian SME owners, business operators, and individuals managing multiple commercial bank accounts (Access Bank, GTBank, Zenith Bank, UBA, Kuda, First Bank) seeking unified balance awareness, multi-account funding, and automated inflow distribution.

## Product Purpose
Apapo (Yoruba for "Combined" / "Aggregation") consolidates fragmented Nigerian bank accounts into a single orchestration platform. It enables users to view combined liquidity, execute split payments across accounts when no single balance is sufficient, and automatically distribute incoming revenues according to predetermined rules.

## Positioning
Unlike simple account aggregators that provide read-only balance dashboards, Apapo provides transactional multi-bank execution with atomic two-phase rollback (reversing earlier debit legs if any downstream transfer fails) and automated incoming revenue distribution (Split-Receive) under Central Bank of Nigeria (CBN) Open Banking regulatory rails.

## Operating Context
- Operational environment: Web app accessible across desktop and mobile browsers, optimized for low-latency operations under variable Nigerian cellular network conditions.
- Clearing rails: Central Bank of Nigeria Open Banking Nigeria API rails, NIBSS Instant Payments (NIP).
- Security & compliance: 90-day revocable Open Banking consent, 4-to-6 digit PIN authorization, USSD failover support for offline recovery, and unverified deposit flagging (ScamShield).

## Capabilities and Constraints
- Multi-Bank Aggregation: Unified balance calculation across Access, GTBank, Zenith, UBA, Kuda, First Bank, and Opay.
- Split-Pay Engine: Multi-account debit planning with atomic rollback restitution on leg failures.
- Split-Receive Engine: Automatic routing of incoming deposits into retained liquidity and target accounts per configurable percentage allocations (strictly capped at 100%).
- Accounting precision: Strict integer kobo accounting (`amount_kobo`) preventing float rounding drift.
- Visual architecture: Pure flat interface without drop shadows or glass blur effects.

## Brand Commitments
- Name: Apapo
- Identity: Institutional, calm, exact financial tooling.
- Core brand palette: Clean slate neutral ramp with deep teal accent (`#0f766e`).
- Real bank colors: Authentic Nigerian bank brand profiles (Access `#003865`, GTBank `#E05A10`, Zenith `#D2232A`, UBA `#BA0C12`, Kuda `#5C249C`, First Bank `#002B49`).

## Evidence on Hand
- Full interactive web prototype and production frontend in React 19 + TypeScript + Vite + Tailwind CSS v4 (`APAPO/frontend/`).
- Full Go backend settlement and mock bank provider service (`APAPO/backend/`).
- Comprehensive unit and end-to-end integration test suite (33/33 tests passing).

## Product Principles
1. Atomic Integrity: Financial operations either complete entirely across all bank legs or roll back cleanly; money is never left in an unverified state.
2. Exact Integer Accounting: All values are stored and calculated as integer kobo; floating-point math is forbidden.
3. Quiet, Legible Chrome: Interface chrome remains neutral and understated so that real financial moments (physical card profiles, routing diagrams, transaction rows) carry authentic clarity.
4. User Consent & Transparency: Open Banking connections and distribution rules are explicit, time-bounded, and revocable at any time.

## Accessibility & Inclusion
- High-contrast visual hierarchy (meeting WCAG 2.1 AA 4.5:1 text contrast).
- Tabular figures (`tabular-nums`) for currency amounts to enable reliable scanability.
- Native keyboard navigation and focus rings across all financial inputs and modals.
- Low-bandwidth optimizations including USSD fallback codes for intermittent network connectivity.
