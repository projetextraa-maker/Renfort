// ─────────────────────────────────────────────────────────────────────────────
// lib/serveur-disponibilites.ts
//
// Matching logic based on day + slot only.
// No hour overlap — simple, strict, predictable.
//
// Slots:
//   midday  = midi       (12h–15h)
//   evening = soir       (18h–23h)
//   full    = journée    = midday AND evening required
// ─────────────────────────────────────────────────────────────────────────────

export type AvailabilityDayKey =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

export type AvailabilitySlotKey = 'midday' | 'evening'

export type CanonicalAvailabilitySlotKey = AvailabilitySlotKey

// Mission slot — what the patron selects when creating a mission
export type MissionSlot = 'midday' | 'evening' | 'full'

export type ServeurDisponibiliteHebdo = {
  id?: string
  serveur_id?: string
  jour: AvailabilityDayKey | string
  creneau: AvailabilitySlotKey | string
}

// ─── Labels ───────────────────────────────────────────────────────────────────

export const WEEKLY_AVAILABILITY_DAYS: { key: AvailabilityDayKey; label: string }[] = [
  { key: 'monday',    label: 'Lundi'    },
  { key: 'tuesday',   label: 'Mardi'    },
  { key: 'wednesday', label: 'Mercredi' },
  { key: 'thursday',  label: 'Jeudi'    },
  { key: 'friday',    label: 'Vendredi' },
  { key: 'saturday',  label: 'Samedi'   },
  { key: 'sunday',    label: 'Dimanche' },
]

export const WEEKLY_AVAILABILITY_SLOTS: { key: AvailabilitySlotKey; label: string }[] = [
  { key: 'midday', label: 'Midi' },
  { key: 'evening', label: 'Soir' },
]

export const CANONICAL_WEEKLY_AVAILABILITY_SLOTS: {
  key: CanonicalAvailabilitySlotKey
  label: string
}[] = [
  { key: 'midday', label: 'Midi' },
  { key: 'evening', label: 'Soir' },
]

export function isCanonicalAvailabilitySlotKey(
  value: string
): value is CanonicalAvailabilitySlotKey {
  return value === 'midday' || value === 'evening'
}

// ─── Weekday extraction (timezone-safe) ──────────────────────────────────────

const UTC_DAY_TO_KEY: Record<number, AvailabilityDayKey> = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
}

/**
 * Extract weekday from "YYYY-MM-DD" using UTC to avoid any timezone shift.
 * e.g. "2026-04-17" → "thursday"
 */
export function getWeekdayFromDateString(dateStr: string): AvailabilityDayKey | null {
  if (!dateStr || typeof dateStr !== 'string') return null
  const parts = dateStr.split('-')
  if (parts.length !== 3) return null
  const year  = parseInt(parts[0] ?? '', 10)
  const month = parseInt(parts[1] ?? '', 10) - 1
  const day   = parseInt(parts[2] ?? '', 10)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  const utc = new Date(Date.UTC(year, month, day))
  if (Number.isNaN(utc.getTime())) return null
  return UTC_DAY_TO_KEY[utc.getUTCDay()] ?? null
}

// ─── Mission slot detection from time range ───────────────────────────────────

/**
 * Given start/end time strings, derive the mission slot.
 * This is used when the patron sets custom hours instead of a preset button.
 *
 * Rules:
 *   start < 15:00 AND end <= 15:00  → midday
 *   start >= 18:00                  → evening
 *   spans both (start < 15, end > 18) → full
 *   otherwise                       → evening (default for ambiguous)
 */
export function detectMissionSlot(heureDebut: string, heureFin: string): MissionSlot {
  const toMin = (t: string): number => {
    const p = t.split(':')
    return parseInt(p[0] ?? '0', 10) * 60 + parseInt(p[1] ?? '0', 10)
  }
  const start = toMin(heureDebut)
  const end   = toMin(heureFin)

  // Midi: starts before 15h and ends at or before 16h
  if (start < 15 * 60 && end <= 16 * 60) return 'midday'

  // Soir: starts at or after 17h
  if (start >= 17 * 60) return 'evening'

  // Journée: spans a big range
  if (start < 15 * 60 && end >= 18 * 60) return 'full'

  // Default
  return 'evening'
}

// ─── Core matching function ───────────────────────────────────────────────────

/**
 * Strict slot-based matching.
 *
 * Rules:
 *   missionSlot === 'midday'  → server must have (missionDay + midday)
 *   missionSlot === 'evening' → server must have (missionDay + evening)
 *   missionSlot === 'full'    → server must have BOTH (missionDay + midday)
 *                               AND (missionDay + evening)
 *
 * Test cases:
 *   ✅ server: lundi midday  | mission: lundi midday  → true
 *   ❌ server: lundi evening | mission: lundi midday  → false
 *   ✅ server: lundi midday + evening | mission: full → true
 *   ❌ server: lundi midday only      | mission: full → false
 */
export function isServerMatchingMission(
  disponibilites: ServeurDisponibiliteHebdo[],
  missionDay: AvailabilityDayKey,
  missionSlot: MissionSlot
): boolean {
  if (!disponibilites || disponibilites.length === 0) return false

  const has = (slot: AvailabilitySlotKey): boolean =>
    disponibilites.some(
      d => String(d.jour).toLowerCase() === missionDay &&
           String(d.creneau).toLowerCase() === slot
    )

  if (missionSlot === 'midday')  return has('midday')
  if (missionSlot === 'evening') return has('evening')
  if (missionSlot === 'full')    return has('midday') && has('evening')

  return false
}

/**
 * Full compatibility check — extracts day from date string then calls isServerMatchingMission.
 * Use this as the single entry point from serveurs-disponibles.tsx.
 */
export function isServerAvailableForMission(
  disponibilites: ServeurDisponibiliteHebdo[],
  missionDate: string,
  missionSlot: MissionSlot
): boolean {
  if (!disponibilites || disponibilites.length === 0) return false
  const day = getWeekdayFromDateString(missionDate)
  if (!day) return false
  return isServerMatchingMission(disponibilites, day, missionSlot)
}

// ─── Legacy helper (kept for getMissionAvailabilityTargets callers) ───────────

export function getAvailabilityKey(jour: string, creneau: string): string {
  return `${String(jour).trim().toLowerCase()}:${String(creneau).trim().toLowerCase()}`
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export function formatWeeklyAvailabilitySummary(
  items: ServeurDisponibiliteHebdo[]
): string[] {
  const grouped = new Map<string, string[]>()
  items.forEach(item => {
    const cur = grouped.get(String(item.jour)) ?? []
    if (!cur.includes(String(item.creneau))) cur.push(String(item.creneau))
    grouped.set(String(item.jour), cur)
  })
  return WEEKLY_AVAILABILITY_DAYS
    .map(({ key, label }) => {
      const rawSlots = grouped.get(key) ?? []
      const slots = rawSlots.filter(isCanonicalAvailabilitySlotKey)
      if (slots.length === 0) return null

      const hasMidday = slots.includes('midday')
      const hasEvening = slots.includes('evening')

      if (hasMidday && hasEvening) {
        return `${label} : Journee`
      }

      const slotLabels = CANONICAL_WEEKLY_AVAILABILITY_SLOTS
        .filter(s => slots.includes(s.key))
        .map(s => s.label)
        .join(', ')

      return `${label} : ${slotLabels}`
    })
    .filter(Boolean) as string[]
}
