import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, apiMode } from '../api/client'
import { toApiError } from '../api/errors'
import { Button, Card, Input, useToast } from '../components/ui'
import { useAuth } from '../context/useAuth'

type FlowMode = 'signup' | 'signin'
type SignupStep = 'phone' | 'otp' | 'bvn' | 'pin'

export function Onboarding({ initialMode }: { initialMode?: FlowMode } = {}) {
  const nav = useNavigate()
  const toast = useToast()
  const { login, completeOnboarding, demoLogin } = useAuth()

  const [mode, setMode] = useState<FlowMode>(() => {
    if (initialMode) return initialMode
    if (typeof window !== 'undefined' && (window.location.pathname.includes('login') || window.location.pathname.includes('signin'))) {
      return 'signin'
    }
    return 'signup'
  })
  const [step, setStep] = useState<SignupStep>('phone')

  // Signup Form State
  const [phone, setPhone] = useState('08012345678')
  const [otp, setOtp] = useState('')
  const [bvn, setBvn] = useState('22222222222')
  const [verifiedName, setVerifiedName] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')

  // Signin Form State
  const [loginPhone, setLoginPhone] = useState('08012345678')
  const [loginPin, setLoginPin] = useState('4821')

  const [loading, setLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  function startResendTimer() {
    setResendCooldown(30)
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  async function handleSendOtp() {
    if (!phone.trim()) {
      toast.show('Please enter your phone number.', 'error')
      return
    }
    setLoading(true)
    try {
      const res = await api.auth.sendOtp(phone.trim())
      toast.show(res.otp ? `Verification code sent. Demo code: ${res.otp}` : 'Verification code sent.', 'success')
      setStep('otp')
      startResendTimer()
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp() {
    if (!otp.trim()) {
      toast.show('Please enter the verification code.', 'error')
      return
    }
    setLoading(true)
    try {
      const res = await api.auth.verifyOtp(phone.trim(), otp.trim())
      completeOnboarding(res.token)
      toast.show('Phone verified successfully.', 'success')
      setStep('bvn')
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitBvn() {
    if (bvn.length !== 11) {
      toast.show('BVN must be exactly 11 digits.', 'error')
      return
    }
    setLoading(true)
    try {
      const res = await api.auth.submitBvn(bvn.trim())
      setVerifiedName(res.name ?? '')
      toast.show(res.name ? `Identity verified: ${res.name}` : 'Identity verified.', 'success')
      setStep('pin')
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleSetPin() {
    if (pin.length < 4 || pin.length > 6) {
      toast.show('PIN must be 4 to 6 digits.', 'error')
      return
    }
    if (pin !== confirmPin) {
      toast.show('PINs do not match. Please re-enter.', 'error')
      return
    }
    setLoading(true)
    try {
      await api.auth.setPin({ pin, confirm_pin: confirmPin })
      toast.show('Security PIN configured. Welcome to Apapo.', 'success')
      nav('/', { replace: true })
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleSignIn() {
    if (!loginPhone.trim() || loginPin.length < 4) {
      toast.show('Please enter your phone number and PIN.', 'error')
      return
    }
    setLoading(true)
    try {
      await login(loginPhone.trim(), loginPin.trim())
      toast.show('Signed in successfully.', 'success')
      nav('/', { replace: true })
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  function handleDemoAccess() {
    demoLogin()
    toast.show('Signed in as demo user.', 'success')
    nav('/', { replace: true })
  }

  const stepsList: { key: SignupStep; label: string }[] = [
    { key: 'phone', label: 'Phone' },
    { key: 'otp', label: 'Code' },
    { key: 'bvn', label: 'BVN' },
    { key: 'pin', label: 'PIN' },
  ]

  const currentStepIndex = stepsList.findIndex((s) => s.key === step)

  return (
    <div className="mx-auto max-w-md space-y-6 py-4 sm:py-8">
      {/* Brand Header */}
      <div className="text-center">
        <div className="inline-flex size-13 items-center justify-center rounded-2xl bg-teal-700 text-white font-bold text-2xl mb-3 transition-colors">
          A
        </div>
        <h1 className="text-3xl font-bold text-slate-950 dark:text-white tracking-tight">
          Apapo<span className="text-teal-700 dark:text-teal-400">.</span>
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400 font-medium">
          Orchestrated multi-rail payments across Nigerian banks
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex rounded-xl bg-slate-200 dark:bg-slate-800 p-1 text-xs sm:text-sm font-semibold">
        <button
          type="button"
          onClick={() => setMode('signup')}
          className={`flex-1 rounded-lg py-2 transition-colors ${
            mode === 'signup'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white'
              : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          New Account
        </button>
        <button
          type="button"
          onClick={() => setMode('signin')}
          className={`flex-1 rounded-lg py-2 transition-colors ${
            mode === 'signin'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white'
              : 'text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Sign In
        </button>
      </div>

      {mode === 'signup' ? (
        <Card className="space-y-5 p-5 sm:p-6 dark:bg-slate-900 dark:border-slate-800">
          {/* Progress Indicators */}
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            {stepsList.map((s, idx) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span
                  className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${
                    idx <= currentStepIndex ? 'bg-teal-700 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {idx + 1}
                </span>
                <span
                  className={`text-xs ${
                    idx === currentStepIndex ? 'text-slate-900 dark:text-white font-bold' : 'text-slate-600 dark:text-slate-400 font-semibold'
                  }`}
                >
                  {s.label}
                </span>
              </div>
            ))}
          </div>

          {/* STEP 1: PHONE NUMBER */}
          {step === 'phone' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Enter your phone number</h2>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400 font-medium">We will verify your mobile number via SMS OTP.</p>
              </div>

              <Input
                label="Mobile Phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08012345678"
                hint="Nigerian phone format (080... or +234...)"
              />

              {apiMode === 'mock' && (
                <p className="rounded-lg bg-amber-50 dark:bg-amber-950/60 p-2 text-xs font-medium text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800/60">
                  Demo note: Seeded demo user phone is 08012345678.
                </p>
              )}

              <Button onClick={handleSendOtp} loading={loading} block>
                Send Verification Code
              </Button>
            </div>
          )}

          {/* STEP 2: OTP VERIFICATION */}
          {step === 'otp' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Enter verification code</h2>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400 font-medium">Sent to {phone}</p>
              </div>

              <Input
                label="6-Digit Code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="123456"
                hint={apiMode === 'mock' ? 'Demo OTP is always 123456' : undefined}
              />

              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 font-medium">
                <button type="button" onClick={() => setStep('phone')} className="text-teal-700 dark:text-teal-400 font-semibold hover:underline">
                  Change phone number
                </button>
                <button
                  type="button"
                  disabled={resendCooldown > 0}
                  onClick={handleSendOtp}
                  className="font-semibold text-teal-700 dark:text-teal-400 hover:underline disabled:text-slate-400 dark:disabled:text-slate-600"
                >
                  {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
                </button>
              </div>

              <Button onClick={handleVerifyOtp} loading={loading} block>
                Verify and Continue
              </Button>
            </div>
          )}

          {/* STEP 3: BVN VERIFICATION */}
          {step === 'bvn' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Verify your identity</h2>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400 font-medium">
                  Enter your 11-digit Bank Verification Number to verify your name against your accounts.
                </p>
              </div>

              <Input
                label="Bank Verification Number (BVN)"
                type="text"
                inputMode="numeric"
                maxLength={11}
                value={bvn}
                onChange={(e) => setBvn(e.target.value.replace(/\D/g, ''))}
                placeholder="11 digits"
                hint="Your BVN is stored only as a secure cryptographic hash."
              />

              {verifiedName && (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/60 p-2.5 text-xs font-semibold text-emerald-900 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800/60">
                  Identity match confirmed: <strong>{verifiedName}</strong>
                </div>
              )}

              <Button onClick={handleSubmitBvn} loading={loading} block>
                Verify Identity
              </Button>
            </div>
          )}

          {/* STEP 4: SET PIN */}
          {step === 'pin' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Create your security PIN</h2>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400 font-medium">
                  This 4 to 6 digit PIN authorizes transfers, limits, and automated rules.
                </p>
              </div>

              <Input
                label="Security PIN"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="4 to 6 digits"
              />

              <Input
                label="Confirm Security PIN"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Re-enter PIN"
              />

              <Button onClick={handleSetPin} loading={loading} block>
                Complete Registration
              </Button>
            </div>
          )}
        </Card>
      ) : (
        /* SIGN IN */
        <Card className="space-y-4 dark:bg-slate-900 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Sign in to Apapo</h2>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400 font-medium">Enter your registered phone number and PIN.</p>
          </div>

          <Input
            label="Phone Number"
            type="tel"
            value={loginPhone}
            onChange={(e) => setLoginPhone(e.target.value)}
            placeholder="08012345678"
          />

          <Input
            label="Security PIN"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={loginPin}
            onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, ''))}
            placeholder="PIN"
          />

          <Button onClick={handleSignIn} loading={loading} block>
            Sign In
          </Button>
        </Card>
      )}

      {/* Quick Demo Access Bar */}
      <div className="pt-2 text-center">
        <Button variant="secondary" onClick={handleDemoAccess} block className="text-xs">
          Quick Demo Sign-In (Bypass)
        </Button>
      </div>
    </div>
  )
}
