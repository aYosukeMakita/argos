import { DashboardShell } from '@/components/dashboard-shell'
import { SessionDetailPage } from '@/components/session-detail-page'

export default async function SessionDetailRoute({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params

  return (
    <DashboardShell
      eyebrow="ARGOS"
      title="Session Timeline"
      description="Round 1 から Round 3 までの発言、判定、最終結果を時系列で追跡します。"
    >
      <SessionDetailPage sessionId={sessionId} />
    </DashboardShell>
  )
}
