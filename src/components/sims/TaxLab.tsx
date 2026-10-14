import { useMemo, useState } from 'react'
import { rupeesShort } from '../../lib/format'
import { Slider, Stat } from './CompoundLab'

/**
 * Income tax lab for India.
 *
 * The point is not to memorise slabs — it is to see three things that surprise
 * people:
 *
 *   1. Tax is *marginal*. Only the slice of income inside a band pays that
 *      band's rate, which is why a modest raise can meaningfully raise
 *      take-home, and why a large one raises tax on the extra part only.
 *   2. Which regime wins depends on your actual deductions, not on a rule of
 *      thumb. Someone with a large home loan is often better off in the old
 *      regime; someone with no deductions almost never is.
 *   3. TDS already paid is not extra tax — it is your own money parked with the
 *      government, refunded or credited if you overpaid.
 *
 * Figures follow the Finance Act position for FY 2026-27 (AY 2027-28):
 * new regime s.115BAC with a ₹4 lakh basic exemption and a ₹75,000 standard
 * deduction for salaried individuals, an s.87A rebate up to ₹60,000, slabs to
 * 30%, surcharge capped at 25% and 4% cess. Old-regime figures are the
 * long-standing 0/5/20/30 structure with a ₹2.5 lakh basic exemption and a
 * ₹50,000 standard deduction.
 *
 * This is an educational estimate, not tax advice — verify against the current
 * Finance Act and your own return before acting on it.
 */

/** New regime (s.115BAC) bands: [upTo, rate]. */
const NEW_BANDS: [number, number][] = [
  [400_000, 0],
  [800_000, 5],
  [1_200_000, 10],
  [1_600_000, 15],
  [2_000_000, 20],
  [2_400_000, 25],
  [Infinity, 30],
]

/** Old regime bands. */
const OLD_BANDS: [number, number][] = [
  [250_000, 0],
  [500_000, 5],
  [1_000_000, 20],
  [Infinity, 30],
]

/** Marginal relief under s.87A in the new regime. */
const NEW_REBATE_LIMIT = 600_000
/** Cap on surcharge under 115BAC — deliberately capped below the old 37%. */
const NEW_SURCHARGE_CAP = 0.25

/** Apply marginal bands to a taxable income. */
export function slabTax(income: number, bands: [number, number][]): number {
  let tax = 0
  let prev = 0
  for (const [upTo, rate] of bands) {
    if (income <= prev) break
    const slice = Math.min(income, upTo) - prev
    tax += (slice * rate) / 100
    prev = upTo
  }
  return tax
}

type Regime = {
  name: string
  bands: [number, number][]
  stdDeduction: number
  rebateCap: number
  surchargeCap: number
  maxDeductions: number
}

const NEW: Regime = {
  name: 'New (115BAC)',
  bands: NEW_BANDS,
  stdDeduction: 75_000,
  rebateCap: NEW_REBATE_LIMIT,
  surchargeCap: NEW_SURCHARGE_CAP,
  maxDeductions: 0,
}

const OLD: Regime = {
  name: 'Old',
  bands: OLD_BANDS,
  stdDeduction: 50_000,
  rebateCap: 12_500,
  surchargeCap: 0.37,
  maxDeductions: 250_000,
}

type Result = {
  taxable: number
  base: number
  rebate: number
  surcharge: number
  cess: number
  total: number
  effective: number
}

/** Full liability for one regime. Deductions only count in the old regime. */
function compute(regime: Regime, gross: number, deductions: number): Result {
  const allowed = Math.min(deductions, regime.maxDeductions)
  const taxable = Math.max(0, gross - regime.stdDeduction - allowed)
  let base = slabTax(taxable, regime.bands)

  // s.87A rebate, only where the liability is small enough to wipe out.
  const rebate = Math.min(base, regime.rebateCap)
  base -= rebate

  // Surcharge on very high incomes, then marginal relief to stop it spiking.
  let surcharge = 0
  if (taxable > 5_000_000) surcharge = base * regime.surchargeCap
  else if (taxable > 2_000_000) surcharge = base * 0.15
  else if (taxable > 1_000_000) surcharge = base * 0.1

  if (surcharge > 0) {
    const capOnIncrease = 50_000 * Math.floor(taxable / 1_000_000)
    const taxAtCap = slabTax(Math.max(0, taxable - capOnIncrease), regime.bands) - rebate
    const ceiling = taxAtCap + capOnIncrease * (base / Math.max(taxable, 1)) * regime.surchargeCap
    if (base + surcharge - ceiling > ceiling) surcharge = Math.max(0, ceiling - base)
  }

  const cess = (base + surcharge) * 0.04
  const total = base + surcharge + cess
  return {
    taxable,
    base,
    rebate,
    surcharge,
    cess,
    total,
    effective: gross > 0 ? (total / gross) * 100 : 0,
  }
}

/** Take-home after crediting TDS already paid. */
const takeHome = (gross: number, total: number, tds: number) => Math.max(0, gross - total - tds)

export function TaxLab() {
  const [ctc, setCtc] = useState(1_200_000)
  const [deductions, setDeductions] = useState(150_000)
  const [tds, setTds] = useState(0)
  const [stcg, setStcg] = useState(0)
  const [ltcg, setLtcg] = useState(0)

  const newRes = useMemo(() => compute(NEW, ctc, deductions), [ctc, deductions])
  const oldRes = useMemo(() => compute(OLD, ctc, deductions), [ctc, deductions])

  const cheaper = newRes.total <= oldRes.total ? 'new' : 'old'
  const winner = cheaper === 'new' ? newRes : oldRes
  const saving = Math.abs(newRes.total - oldRes.total)

  // Equity gains are taxed on their own special rates, never as ordinary income.
  // s.112A exempts ₹1.25 lakh of LTCG a year, then 12.5% without indexation.
  // s.111A taxes STCG on listed equity at 20%.
  const ltcTaxable = Math.max(0, ltcg - 125_000) * 0.125
  const stcgTax = stcg * 0.2
  const gainsTax = ltcTaxable + stcgTax
  const gainsTotal = stcg + ltcg

  const netOfGains = ctc - winner.total - tds + (gainsTotal - gainsTax)

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-400">
        Set your income and deductions to see which regime wins, how marginal the slabs really are, and
        what TDS already paid does to your take-home.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Slider label="Gross annual income" value={ctc} display={rupeesShort(ctc)} min={200_000} max={5_000_000} step={25_000} onChange={setCtc} />
        <Slider
          label="Old-regime deductions (80C, 80D, HRA, NPS, home loan)"
          value={deductions}
          display={rupeesShort(deductions)}
          min={0}
          max={800_000}
          step={10_000}
          onChange={setDeductions}
        />
        <Slider label="TDS already deducted" value={tds} display={rupeesShort(tds)} min={0} max={600_000} step={5_000} onChange={setTds} />
        <Slider label="Equity STCG in the year" value={stcg} display={rupeesShort(stcg)} min={0} max={500_000} step={5_000} onChange={setStcg} />
        <Slider label="Equity LTCG in the year" value={ltcg} display={rupeesShort(ltcg)} min={0} max={500_000} step={5_000} onChange={setLtcg} />
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label={`${winner === newRes ? 'New' : 'Old'} regime tax`} value={rupeesShort(winner.total)} tone="bad" />
        <Stat label="Effective rate" value={`${winner.effective.toFixed(1)}%`} tone="neutral" />
        <Stat label="Take-home after TDS" value={rupeesShort(takeHome(ctc, winner.total, tds))} tone="best" />
        <Stat label="Regime difference" value={rupeesShort(saving)} tone={saving > 20_000 ? 'best' : 'neutral'} />
      </div>

      <SlabTable bands={winner === newRes ? NEW_BANDS : OLD_BANDS} income={winner.taxable} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div
          className={`rounded-xl border p-4 ${
            cheaper === 'new' ? 'border-brand-400/40 bg-brand-400/5' : 'border-white/10 bg-white/5'
          }`}
        >
          <div className="mb-1 text-[11px] uppercase tracking-wide text-brand-300">New regime (115BAC)</div>
          <p className="font-display text-xl text-white">{rupeesShort(newRes.total)}</p>
          <p className="mt-1 text-xs text-ink-400">
            {rupeesShort(newRes.taxable)} taxable · {newRes.effective.toFixed(1)}% effective
            {newRes.rebate > 0 && ` · rebate ${rupeesShort(newRes.rebate)}`}
          </p>
          <p className="mt-2 text-xs text-ink-500">
            A flat ₹75,000 standard deduction, a wider exemption and no 80C-style deductions. A rebate up
            to ₹60,000 means income up to roughly ₹12.8 lakh can end up effectively tax-free.
          </p>
        </div>
        <div
          className={`rounded-xl border p-4 ${
            cheaper === 'old' ? 'border-sky-400/40 bg-sky-400/5' : 'border-white/10 bg-white/5'
          }`}
        >
          <div className="mb-1 text-[11px] uppercase tracking-wide text-sky-300">Old regime</div>
          <p className="font-display text-xl text-white">{rupeesShort(oldRes.total)}</p>
          <p className="mt-1 text-xs text-ink-400">
            {rupeesShort(oldRes.taxable)} taxable · {oldRes.effective.toFixed(1)}% effective
            {oldRes.rebate > 0 && ` · rebate ${rupeesShort(oldRes.rebate)}`}
          </p>
          <p className="mt-2 text-xs text-ink-500">
            Deductions of up to {rupeesShort(OLD.maxDeductions)} can come off before slabs apply, which is
            why a large home loan or NPS contribution can still make this cheaper.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-ink-200">
        {saving < 20_000 ? (
          <>
            <strong className="text-white">The two regimes are close here.</strong> With ₹
            {rupeesShort(deductions).replace('₹', '')} of deductions the gap is only {rupeesShort(saving)}.
            Pick on convenience, not on the difference — and re-check whenever your deductions change
            materially, since a home loan or a large NPS year can flip the answer entirely.
          </>
        ) : cheaper === 'new' ? (
          <>
            <strong className="text-brand-200">The new regime wins by {rupeesShort(saving)}.</strong> Your
            deductions are not large enough to justify the old slabs. This is the common case, because most
            people&apos;s deductions are far below the ₹1.5 lakh that the new regime gives away.
          </>
        ) : (
          <>
            <strong className="text-sky-200">The old regime wins by {rupeesShort(saving)}.</strong> Your
            deductions are large enough that starting from the ₹2.5 lakh exemption and paying a lower rate on
            the next band beats the new regime&apos;s wider exemption. This is usually a home-loan year.
          </>
        )}
      </div>

      {gainsTotal > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-400">Equity capital gains (taxed separately)</div>
          <p className="text-sm text-ink-200">
            {rupeesShort(gainsTotal)} of gains costs {rupeesShort(gainsTax)} in tax.
          </p>
          <p className="mt-1 text-xs text-ink-400">
            LTCG above ₹1,25,000 is taxed at 12.5% without indexation under s.112A, and equity STCG at 20%
            under s.111A. Holding past 12 months is the single most valuable thing you can do for your tax bill.
          </p>
          <p className="mt-1.5 text-xs text-ink-500">
            Net annual position after tax and TDS credit:{' '}
            <span className="font-semibold text-brand-200">{rupeesShort(netOfGains)}</span>
          </p>
        </div>
      )}

      <p className="text-[11px] text-ink-600">
        Educational estimate based on the Finance Act position for FY 2026-27 (AY 2027-28), including the 4%
        cess and capped surcharge. Rebate and marginal relief are applied as the Act provides. Not tax
        advice — confirm against the current Act and your own computation before filing.
      </p>
    </div>
  )
}

/** The band-by-band ladder, showing only the portion taxed at each rate. */
function SlabTable({ bands, income }: { bands: [number, number][]; income: number }) {
  let prev = 0
  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-white/5 text-xs uppercase tracking-wide text-ink-400">
            <th className="px-3 py-2 text-left font-semibold">Band</th>
            <th className="px-3 py-2 text-right font-semibold">Rate</th>
            <th className="px-3 py-2 text-right font-semibold">Taxed here</th>
            <th className="px-3 py-2 text-right font-semibold">Tax</th>
          </tr>
        </thead>
        <tbody>
          {bands.map(([upTo, rate]) => {
            const width = upTo === Infinity ? Math.max(0, income - prev) : Math.max(0, Math.min(income, upTo) - prev)
            const rowTax = (width * rate) / 100
            const bandLabel = upTo === Infinity ? `Above ${rupeesShort(prev)}` : `Next ${rupeesShort(upTo - prev)}`
            const start = prev
            prev = upTo === Infinity ? income : upTo
            return (
              <tr key={bandLabel + rate} className="border-t border-white/5">
                <td className="px-3 py-1.5 text-ink-300">
                  {rupeesShort(start)} – {upTo === Infinity ? '∞' : rupeesShort(upTo)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-300">{rate}%</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-300">{rupeesShort(width)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-200">{rupeesShort(rowTax)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="bg-white/5 px-3 py-2 text-[11px] text-ink-500">
        This is what &quot;marginal&quot; means: a ₹1 lakh rise from {rupeesShort(200_000)} to{' '}
        {rupeesShort(300_000)} adds {rupeesShort(100_000)} of income but only{' '}
        {rupeesShort((100_000 * 5) / 100)} of tax, because nothing is taxed at a higher rate.
      </p>
    </div>
  )
}