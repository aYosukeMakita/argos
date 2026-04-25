import { DashboardShell } from '@/components/dashboard-shell'
import { ReviewsPage } from '@/components/reviews-page'

export default async function ReviewsRoute({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams
  const parsedPage = Number.parseInt(params.page ?? '1', 10)
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1

  return (
    <DashboardShell
      eyebrow="ARGOS"
      title="Review Ledger"
      description="Reviewer が保存した一次レビューを一覧化し、そこから議論セッションへ接続します。"
    >
      <ReviewsPage page={page} />
    </DashboardShell>
  )
}
