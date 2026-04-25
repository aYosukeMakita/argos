import type { Metadata } from 'next'
import { IBM_Plex_Sans_JP, Space_Grotesk } from 'next/font/google'
import './globals.css'

const headingFont = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-heading',
})

const bodyFont = IBM_Plex_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
})

export const metadata: Metadata = {
  title: 'ARGOS Dashboard',
  description: 'Multi-Agent Code Review Automation System dashboard',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className={`${headingFont.variable} ${bodyFont.variable}`}>{children}</body>
    </html>
  )
}
