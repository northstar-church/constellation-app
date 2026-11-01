export function ComingSoon({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="coming">
      <div className="badge">{icon}</div>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  )
}
