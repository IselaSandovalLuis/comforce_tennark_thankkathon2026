import { useEffect, useState } from 'react'
import { caseChange } from '../services/caseData'

export function useCaseUpdates() {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const refresh = () => setVersion(value => value + 1)
    window.addEventListener(caseChange, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(caseChange, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  return version
}
