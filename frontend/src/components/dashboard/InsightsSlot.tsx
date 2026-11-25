import type { FeedRow } from '../../api/types'
import { InsightsCard } from './InsightsCard'

export function InsightsSlot({ feed = [] }: { feed?: FeedRow[] }) {
  return <InsightsCard feed={feed} />
}
