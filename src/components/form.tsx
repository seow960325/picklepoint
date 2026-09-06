import type { ReactNode } from 'react'

export const Section = ({ n, title, hint, children }: {
  n: number; title: string; hint?: string; children: ReactNode
}) => (
  <section className="border-b border-line px-5 py-5">
    <div className="mb-3 flex items-baseline gap-2.5">
      <span className="font-display text-xs font-bold text-brand-fg bg-brand rounded px-1.5 py-0.5">{n}</span>
      <h2 className="font-display text-xl font-bold tracking-wide">{title}</h2>
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </div>
    {children}
  </section>
)

export const Field = ({ label, children, className = '' }: {
  label: string; children: ReactNode; className?: string
}) => (
  <label className={`block ${className}`}>
    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
      {label}
    </span>
    {children}
  </label>
)

export const input =
  'rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-fg outline-none ' +
  'placeholder:text-fg-subtle focus:border-brand'

/** Most inputs want the full width of their cell; the narrow ones opt out. */
export const inputFull = input + ' w-full'

export const Stepper = ({ value, onChange, min = 1, max = 99, suffix, format }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string
  format?: (v: number) => string
}) => (
  <div className="flex items-center gap-1">
    <button type="button" onClick={() => onChange(Math.max(min, value - 1))}
      className="h-9 w-9 shrink-0 rounded-lg border border-line bg-surface font-display text-lg font-bold text-fg-muted active:bg-surface-2">
      −
    </button>
    <div className="tabular w-14 text-center font-display text-2xl font-bold">
      {format ? format(value) : value}
    </div>
    <button type="button" onClick={() => onChange(Math.min(max, value + 1))}
      className="h-9 w-9 shrink-0 rounded-lg border border-line bg-surface font-display text-lg font-bold text-fg-muted active:bg-surface-2">
      +
    </button>
    {suffix && <span className="ml-1 text-xs text-fg-subtle">{suffix}</span>}
  </div>
)

export const Choice = ({ options, value, onChange }: {
  options: Array<{ label: string; value: string | number }>
  value: string | number
  onChange: (v: any) => void
}) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map(o => (
      <button key={String(o.value)} type="button" onClick={() => onChange(o.value)}
        className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${
          value === o.value ? 'bg-brand text-brand-fg' : 'border border-line bg-surface text-fg-muted'}`}>
        {o.label}
      </button>
    ))}
  </div>
)

export const Warn = ({ children }: { children: ReactNode }) =>
  <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
    {children}
  </div>
