type WeightEntry = { record_date: string; weight_kg: number };

export function WeightChart({ entries, tall = false }: { entries: WeightEntry[]; tall?: boolean }) {
  if (entries.length < 2) return <div className={`chart-empty ${tall ? "tall" : ""}`}><span>↗</span><p>再记录一天，就能看到趋势线</p></div>;
  const width = 720;
  const height = tall ? 280 : 210;
  const padX = 28;
  const padY = 26;
  const values = entries.map((item) => item.weight_kg);
  const min = Math.min(...values) - 0.8;
  const max = Math.max(...values) + 0.8;
  const range = max - min || 1;
  const points = entries.map((item, index) => ({
    x: padX + (index / Math.max(entries.length - 1, 1)) * (width - padX * 2),
    y: padY + ((max - item.weight_kg) / range) * (height - padY * 2),
    ...item,
  }));
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${path} L${points.at(-1)!.x},${height - padY} L${points[0].x},${height - padY} Z`;
  return <div className={`weight-chart ${tall ? "tall" : ""}`}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="体重趋势折线图">
      {[0.25, 0.5, 0.75].map((ratio) => <line key={ratio} x1={padX} x2={width - padX} y1={padY + ratio * (height - padY * 2)} y2={padY + ratio * (height - padY * 2)} className="grid-line" />)}
      <path d={area} className="chart-area" /><path d={path} className="chart-line" />
      {points.map((point, index) => <g key={`${point.record_date}-${index}`}><circle cx={point.x} cy={point.y} r={index === points.length - 1 ? 6 : 3.5} className="chart-dot" /><title>{point.record_date} · {point.weight_kg.toFixed(1)} kg</title></g>)}
    </svg>
    <div className="chart-labels"><span>{entries[0].record_date.slice(5).replace("-", "/")}</span><strong>{entries.at(-1)!.weight_kg.toFixed(1)} kg</strong><span>{entries.at(-1)!.record_date.slice(5).replace("-", "/")}</span></div>
  </div>;
}

export function ExpenseBars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((item) => item.value), 1);
  return <div className="expense-bars">{data.map((item, index) => <div key={item.label}><div className="bar-label"><span>{item.label}</span><strong>¥{(item.value / 100).toFixed(2)}</strong></div><div className="bar-track"><i style={{ width: `${(item.value / max) * 100}%`, background: index % 2 ? "var(--mint)" : "var(--coral)" }} /></div></div>)}</div>;
}
