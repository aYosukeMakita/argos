import type { ReactNode } from 'react'

interface StatusBadgeProps {
  tone: 'neutral' | 'success' | 'danger' | 'warning'
  children: ReactNode
}

export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return <span className={`status-badge status-${tone}`}>{children}</span>
}
