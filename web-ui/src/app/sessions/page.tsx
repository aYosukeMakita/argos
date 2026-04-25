import { DashboardShell } from '@/components/dashboard-shell'
import { SessionsPage } from '@/components/sessions-page'

export default async function SessionsRoute({ searchParams }: { searchParams: Promise<{ review_id?: string }> }) {
  const params = await searchParams

  return (
    <DashboardShell
      eyebrow="ARGOS"
      title="Session Board"
      description="進行中と完了済みの議論セッションを一覧表示します。"
    >
      <SessionsPage reviewId={params.review_id} />
    </DashboardShell>
  )
}
