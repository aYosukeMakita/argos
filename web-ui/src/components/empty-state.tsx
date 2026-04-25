export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="state-card">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  )
}
