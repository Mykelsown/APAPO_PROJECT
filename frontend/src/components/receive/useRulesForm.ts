import { useState } from 'react'
import { api } from '../../api/client'
import { toApiError } from '../../api/errors'
import type { Account, DestinationInput, SplitReceiveRules } from '../../api/types'
import { useToast } from '../ui'
import { parseNairaToKobo } from '../../lib/money'

interface Source {
  rules: SplitReceiveRules | null
  accounts: Account[]
}

/**
 * Everything the rules editor and the simulator share: the draft rules, the confirmation fields,
 * and the actions that save or disable them. It lives above the tabs so unsaved edits survive a tab switch.
 */
export function useRulesForm(source: Source | null | undefined, reload: () => Promise<unknown>) {
  const toast = useToast()
  const accounts = source?.accounts ?? []

  const [receivingId, setReceivingId] = useState<string>('')
  const [destinations, setDestinations] = useState<DestinationInput[]>([])
  const [consent, setConsent] = useState(false)
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)
  // Simulator test amount in naira text
  const [simNaira, setSimNaira] = useState('100,000')

  // Fill the form whenever fresh data arrives (adjusting state while rendering, not in an effect).
  const [syncedSource, setSyncedSource] = useState(source)
  if (source !== syncedSource) {
    setSyncedSource(source)
    if (source?.rules) {
      setReceivingId(source.rules.receiving_account_id)
      setDestinations(source.rules.destinations)
      setConsent(source.rules.active)
    } else if (source?.accounts && source.accounts.length > 0) {
      setReceivingId(source.accounts[0].account_id)
    }
  }

  const totalPercent = destinations.reduce((sum, d) => sum + (d.percent ?? 0), 0)
  const testKobo = parseNairaToKobo(simNaira) ?? 10_000_000

  function addDestination() {
    if (destinations.length >= 4) {
      toast.show('Maximum 4 destinations allowed.', 'error')
      return
    }
    const available = accounts.find((a) => a.account_id !== receivingId && !destinations.some((d) => d.account_id === a.account_id))
    if (available) {
      setDestinations([...destinations, { account_id: available.account_id, percent: 20 }])
    } else {
      setDestinations([
        ...destinations,
        {
          beneficiary: {
            bank_code: 'zenith',
            account_number: '1000000003',
            account_name: 'Beneficiary',
          },
          fixed_kobo: 500_000,
        },
      ])
    }
  }

  function removeDestination(index: number) {
    setDestinations(destinations.filter((_, i) => i !== index))
  }

  function updateDestination(index: number, updated: Partial<DestinationInput>) {
    setDestinations(destinations.map((d, i) => (i === index ? { ...d, ...updated } : d)))
  }

  async function saveRules() {
    if (!receivingId) {
      toast.show('Please choose a receiving account.', 'error')
      return
    }
    if (totalPercent > 100) {
      toast.show('Total percentage cannot exceed 100%.', 'error')
      return
    }
    if (!consent) {
      toast.show('Standing consent is required to automatically split credits.', 'error')
      return
    }
    if (pin.length < 4) {
      toast.show('Please enter your 4 to 6 digit security PIN.', 'error')
      return
    }

    setSaving(true)
    try {
      await api.splitReceive.setRules({
        receiving_account_id: receivingId,
        destinations,
        standing_consent: consent,
        pin,
      })
      toast.show('Split-Receive rules activated successfully.', 'success')
      setPin('')
      await reload()
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function disableRules() {
    setSaving(true)
    try {
      await api.splitReceive.disableRules()
      toast.show('Split-Receive rules disabled.', 'info')
      await reload()
    } catch (e) {
      toast.show(toApiError(e).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  function applyPreset(preset: 'sme' | 'family' | 'wealth') {
    const otherAccounts = accounts.filter((a) => a.account_id !== receivingId)
    if (otherAccounts.length === 0) {
      toast.show('Link additional accounts to use strategy presets.', 'info')
      return
    }

    if (preset === 'sme') {
      const targets: DestinationInput[] = [
        { account_id: otherAccounts[0].account_id, percent: 30 },
      ]
      if (otherAccounts.length > 1) {
        targets.push({ account_id: otherAccounts[1].account_id, percent: 10 })
      }
      setDestinations(targets)
      toast.show('Applied SME / Business preset (60% Ops, 30% Tax, 10% Reserve).', 'success')
    } else if (preset === 'family') {
      const targets: DestinationInput[] = [
        { account_id: otherAccounts[0].account_id, percent: 25 },
      ]
      setDestinations(targets)
      toast.show('Applied Family Provider preset (75% Main, 25% Savings).', 'success')
    } else if (preset === 'wealth') {
      const targets: DestinationInput[] = [
        { account_id: otherAccounts[0].account_id, percent: 30 },
      ]
      if (otherAccounts.length > 1) {
        targets.push({ account_id: otherAccounts[1].account_id, percent: 20 })
      }
      setDestinations(targets)
      toast.show('Applied 50/30/20 Rule preset (50% Main, 30% Savings, 20% Investment).', 'success')
    }
  }

  return {
    accounts,
    rules: source?.rules ?? null,
    receivingId,
    setReceivingId,
    destinations,
    consent,
    setConsent,
    pin,
    setPin,
    saving,
    simNaira,
    setSimNaira,
    totalPercent,
    testKobo,
    addDestination,
    removeDestination,
    updateDestination,
    applyPreset,
    saveRules,
    disableRules,
  }
}

export type RulesForm = ReturnType<typeof useRulesForm>
