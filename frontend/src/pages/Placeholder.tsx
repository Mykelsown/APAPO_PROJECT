import { Card } from '../components/ui'

export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <Card className="mt-4">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-white">{title}</h1>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300 font-medium">Built in phase {phase}.</p>
    </Card>
  )
}
