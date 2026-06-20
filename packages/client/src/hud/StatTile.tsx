/** Beveled HUD stat tile (pixel-art, Variant B), shared by character and building panels. */
export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile">
      <div className="px" style={{ fontSize: 11, color: '#fac775', opacity: 0.85 }}>
        {label}
      </div>
      <div className="px" style={{ fontSize: 16 }}>
        {value}
      </div>
    </div>
  );
}
