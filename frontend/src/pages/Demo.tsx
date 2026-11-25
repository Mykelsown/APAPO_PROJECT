import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, demo } from '../api/client'
import { toApiError } from '../api/errors'
import { Button, Card, useToast } from '../components/ui'

export function Demo() {
  const nav = useNavigate()
  const toast = useToast()
  const [failureActive, setFailureActive] = useState(() => demo.forceFailure)
  const [busy, setBusy] = useState(false)

  async function handleToggleFailure(enable: boolean) {
    setBusy(true)
    try {
      await api.demo.setFailure({
        bank_code: enable ? 'savanna' : undefined,
        mode: enable ? 'bank_down' : 'none',
      })
      demo.forceFailure = enable
      setFailureActive(enable)
      toast.show(
        enable
          ? 'Failure mode activated: next payment will fail and trigger rollback'
          : 'Normal mode restored: payments will complete normally',
        enable ? 'info' : 'success',
      )
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleSimulateSalary() {
    setBusy(true)
    try {
      const res = await api.splitReceive.simulateCredit({
        amount_kobo: 10_000_000, // ₦100,000
        sender_name: 'Northwind Tech Ltd (Salary)',
        verified: true,
      })
      toast.show(
        `₦100,000 salary credit simulated! New run created: ${res.scan?.new_runs[0] ?? 'SR-0002'}`,
        'success',
      )
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleSimulateUnverified() {
    setBusy(true)
    try {
      await api.splitReceive.simulateCredit({
        amount_kobo: 8_000_000, // ₦80,000
        sender_name: 'Unknown Transfer',
        verified: false,
      })
      toast.show(
        '₦80,000 unverified credit arrived. It was flagged for Wrong-Transfer Scam Shield.',
        'info',
      )
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 pt-2 pb-12 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800/60 px-3 py-1 text-xs font-bold text-teal-800 dark:text-teal-300">
            Ogun Innovate Hackathon · Fintech Track
          </span>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
            Stage Demo Toolkit
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 font-medium">
            One-tap triggers aligned to the 5-minute Pitch Practice Pack demo sequence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/login">
            <Button variant="secondary" className="text-xs">
              Test Login Page
            </Button>
          </Link>
          <Link to="/">
            <Button variant="secondary" className="text-xs">
              Dashboard
            </Button>
          </Link>
        </div>
      </div>

      {/* Failure Status Banner */}
      <div
        className={`rounded-2xl border p-4.5 transition-all ${
          failureActive
            ? 'border-red-300 bg-red-50/70 dark:border-red-800/80 dark:bg-red-950/40 text-red-950 dark:text-red-200'
            : 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-800/80 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-200'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className={`size-3.5 rounded-full ${
                failureActive ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'
              }`}
            />
            <div>
              <p className="font-bold text-sm">
                {failureActive
                  ? 'Simulated Failure Active (Savanna / 3rd Leg Down)'
                  : 'Normal Mode Active (All Bank Legs Succeed)'}
              </p>
              <p className="text-xs opacity-90 mt-0.5">
                {failureActive
                  ? 'The next Split-Pay will fail on the final leg and trigger atomic two-phase rollback.'
                  : 'Payments will execute across all planned bank legs and complete successfully.'}
              </p>
            </div>
          </div>
          <Button
            variant={failureActive ? 'secondary' : 'primary'}
            onClick={() => handleToggleFailure(!failureActive)}
            loading={busy}
            className="text-xs font-bold shrink-0"
          >
            {failureActive ? 'Reset to Normal' : 'Force Savanna Failure'}
          </Button>
        </div>
      </div>

      {/* Pitch Step Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Step 1 */}
        <Card className="space-y-3 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-teal-700 dark:text-teal-400">1:30 - 1:45</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">Step 1</span>
            </div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">Unified Dashboard</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              Show combined liquidity across linked bank accounts, physical card designs, and unverified deposit flagging.
            </p>
          </div>
          <Button block variant="secondary" onClick={() => nav('/')} className="text-xs font-bold">
            Open Dashboard
          </Button>
        </Card>

        {/* Step 2 */}
        <Card className="space-y-3 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-teal-700 dark:text-teal-400">1:45 - 2:20</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">Step 2</span>
            </div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">₦150,000 Split-Pay (3 Banks)</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              Pay an amount no single account covers. Apapo orchestrates across 3 accounts with transparent leg fees.
            </p>
          </div>
          <Button block onClick={() => nav('/pay')} className="text-xs font-bold">
            Start ₦150,000 Split-Pay
          </Button>
        </Card>

        {/* Step 3 */}
        <Card className="space-y-3 p-5 flex flex-col justify-between border-amber-200 dark:border-amber-800/60">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-amber-700 dark:text-amber-400">2:20 - 2:55</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">Step 3</span>
            </div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">Two-Phase Rollback Test</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              With failure active, execute payment. Watch Apapo roll back earlier debited legs: <span className="font-semibold text-slate-900 dark:text-white">"We reversed the earlier steps. Your money is back."</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              block
              onClick={() => handleToggleFailure(true)}
              className="text-xs font-bold flex-1"
            >
              1. Enable Failure
            </Button>
            <Button
              block
              onClick={() => nav('/pay')}
              className="text-xs font-bold flex-1"
            >
              2. Run Payment
            </Button>
          </div>
        </Card>

        {/* Step 4 */}
        <Card className="space-y-3 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-teal-700 dark:text-teal-400">2:55 - 3:20</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">Step 4</span>
            </div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">Safe Send Scam Screening</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              Preview payment to a high-risk recipient flagged by 3+ independent reporters. Enforces explicit liability checkbox.
            </p>
          </div>
          <Button block variant="secondary" onClick={() => nav('/pay')} className="text-xs font-bold">
            Inspect Safe Send
          </Button>
        </Card>

        {/* Step 5 */}
        <Card className="space-y-3 p-5 flex flex-col justify-between sm:col-span-2 border-teal-200 dark:border-teal-800/60 bg-teal-50/30 dark:bg-teal-950/10">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-teal-700 dark:text-teal-400">3:20 - 4:00</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300">Step 5</span>
            </div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">Split-Receive: 30% Savings & 40% Feeding</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              Simulate an incoming salary credit. Apapo automatically divides it according to user rules with an immutable double-entry ledger (<span className="font-mono text-slate-900 dark:text-white font-semibold">Sent + Held + Kept = Credit</span>).
            </p>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              onClick={handleSimulateSalary}
              loading={busy}
              className="text-xs font-bold flex-1"
            >
              + ₦100,000 Salary (30% Savings / 40% Feeding)
            </Button>
            <Button
              variant="secondary"
              onClick={handleSimulateUnverified}
              loading={busy}
              className="text-xs font-bold flex-1"
            >
              + ₦80,000 Unverified (Scam Shield Test)
            </Button>
            <Button
              variant="ghost"
              onClick={() => nav('/receive')}
              className="text-xs font-bold"
            >
              View Ledger →
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
