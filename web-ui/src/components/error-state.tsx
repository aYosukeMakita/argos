export function ErrorState({ message }: { message: string }) {
  return (
    <div className="state-card state-error">
      <h2>データ取得に失敗しました</h2>
      <p>{message}</p>
    </div>
  )
}
