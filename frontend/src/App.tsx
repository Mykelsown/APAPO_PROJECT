import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { PageFallback } from './components/PageFallback'

// Each screen is its own chunk, so the first paint only downloads the shell and the page you open.
const Aggregator = lazy(() => import('./pages/Aggregator').then((m) => ({ default: m.Aggregator })))
const Banks = lazy(() => import('./pages/Banks').then((m) => ({ default: m.Banks })))
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const Demo = lazy(() => import('./pages/Demo').then((m) => ({ default: m.Demo })))
const DevApi = lazy(() => import('./pages/DevApi').then((m) => ({ default: m.DevApi })))
const Onboarding = lazy(() => import('./pages/Onboarding').then((m) => ({ default: m.Onboarding })))
const Placeholder = lazy(() => import('./pages/Placeholder').then((m) => ({ default: m.Placeholder })))
const Security = lazy(() => import('./pages/Security').then((m) => ({ default: m.Security })))
const SplitPay = lazy(() => import('./pages/pay/SplitPay').then((m) => ({ default: m.SplitPay })))
const SplitReceive = lazy(() => import('./pages/receive/SplitReceive').then((m) => ({ default: m.SplitReceive })))

export default function App() {
  return (
    <Routes>
      <Route
        path="onboarding"
        element={
          <Suspense fallback={<PageFallback />}>
            <Onboarding />
          </Suspense>
        }
      />
      <Route
        path="login"
        element={
          <Suspense fallback={<PageFallback />}>
            <Onboarding initialMode="signin" />
          </Suspense>
        }
      />
      <Route
        path="signin"
        element={
          <Suspense fallback={<PageFallback />}>
            <Onboarding initialMode="signin" />
          </Suspense>
        }
      />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="pay" element={<SplitPay />} />
        <Route path="receive" element={<SplitReceive />} />
        <Route path="aggregator" element={<Aggregator />} />
        <Route path="banks" element={<Banks />} />
        <Route path="security" element={<Security />} />
        <Route path="demo" element={<Demo />} />
        <Route path="dev" element={<DevApi />} />
        <Route path="*" element={<Placeholder title="Page not found" phase="F0" />} />
      </Route>
    </Routes>
  )
}
