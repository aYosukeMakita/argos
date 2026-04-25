import { DashboardShell } from '@/components/dashboard-shell'
import { ReviewDetailPage } from '@/components/review-detail-page'

export default async function ReviewDetailRoute({ params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params

  return (
    <DashboardShell
      eyebrow="ARGOS"
      title="Review Detail"
      description="一次レビュー本文と、そのレビューに紐づく examiner session を確認します。"
    >
      <ReviewDetailPage reviewId={reviewId} />
    </DashboardShell>
  )
}
