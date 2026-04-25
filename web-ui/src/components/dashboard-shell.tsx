import Link from 'next/link'
import type { ReactNode } from 'react'

interface DashboardShellProps {
  title: string
  eyebrow: string
  description: string
  children: ReactNode
}

export function DashboardShell({ title, eyebrow, description, children }: DashboardShellProps) {
  return (
    <div className="page-shell">
      <header className="hero-card">
        <p className="eyebrow">{eyebrow}</p>
        <div className="hero-headline-row">
          <div>
            <h1>{title}</h1>
            <p className="hero-description">{description}</p>
          </div>
          <nav className="top-nav">
            <Link href="/reviews">Reviews</Link>
            <Link href="/sessions">Sessions</Link>
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}
