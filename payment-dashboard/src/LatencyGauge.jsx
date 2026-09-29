import { useDebounce } from './useDebounce'

/**
 * Compact latency gauge component
 * Displays real-time API latency with visual indicator
 * 
 * Debounces the `latency` and `status` props so rapid API-call bursts do
 * not cause layout thrashing.  Updates are coalesced and only applied after
 * the value has been stable for DEBOUNCE_MS milliseconds.
 *
 * @param {number|null} latency - Latency in milliseconds
 * @param {string} status - Status: idle, checking, healthy, unhealthy
 * @param {number} [debounceMs=150] - Debounce window in milliseconds
 */
export const LatencyGauge = ({ latency, status, debounceMs = 150 }) => {
  const debouncedLatency = useDebounce(latency, debounceMs)
  const debouncedStatus = useDebounce(status, debounceMs)

  // Determine color based on latency value and status
  const getColorClass = () => {
    if (debouncedStatus === 'checking') return 'checking'
    if (debouncedStatus === 'unhealthy') return 'unhealthy'
    if (debouncedLatency === null) return 'idle'
    
    if (debouncedLatency < 100) return 'excellent'
    if (debouncedLatency < 200) return 'good'
    if (debouncedLatency < 500) return 'fair'
    return 'poor'
  }

  const getLabel = () => {
    if (debouncedStatus === 'checking') return 'Checking...'
    if (debouncedStatus === 'unhealthy') return 'Offline'
    if (debouncedLatency === null) return '--'
    return `${debouncedLatency}ms`
  }

  const getAriaLabel = () => {
    if (debouncedStatus === 'checking') return 'API latency: checking'
    if (debouncedStatus === 'unhealthy') return 'API connection offline'
    if (debouncedLatency === null) return 'API latency: unknown'
    return `API latency: ${debouncedLatency} milliseconds`
  }

  return (
    <div className={`latency-gauge ${getColorClass()}`} aria-label={getAriaLabel()}>
      <div className="gauge-dot" />
      <span className="gauge-value">{getLabel()}</span>
    </div>
  )
}

export default LatencyGauge
