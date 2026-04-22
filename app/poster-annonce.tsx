import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Modal, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { buildAnnoncePosteLabel, normalizeAnnoncePostes } from '../lib/annonce-postes'
import { EURO } from '../lib/currency'
import { fetchEtablissementsForPatron, getPreferredEtablissement, touchEtablissementLastUsed, type Etablissement } from '../lib/etablissements'
import { haversineKm } from '../lib/location-distance'
import { envoyerNotificationLocale } from '../lib/notifications'
import { type MissionSlot } from '../lib/serveur-disponibilites'
import { supabase } from '../lib/supabase'

// Geocoder

const geocoderVille = async (ville: string): Promise<{ lat: number; lng: number } | null> => {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(ville)}&format=json&limit=1&countrycodes=fr`,
      { headers: { 'User-Agent': 'Renfort/1.0' } }
    )
    const d = await r.json()
    if (d && d.length > 0) return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) }
    return null
  } catch { return null }
}

// Constants

const POSTE_OPTIONS   = ['Barman', 'Runner', 'Plongeur', 'Chef de rang', 'Autre']
const SALAIRE_OPTIONS = ['12', '13', '14', '15']

type PresetKey = 'Midi' | 'Journee' | 'Soir'

interface Preset {
  label:       PresetKey
  slot:        MissionSlot
  // Midi / Soir
  debutMidi?:  string
  finMidi?:    string
  debutSoir?:  string
  finSoir?:    string
}

const PRESETS: Preset[] = [
  { label: 'Midi',    slot: 'midday',  debutMidi: '11:30', finMidi: '15:00' },
  { label: 'Journee', slot: 'full',    debutMidi: '11:30', finMidi: '15:00', debutSoir: '18:00', finSoir: '23:00' },
  { label: 'Soir',    slot: 'evening', debutSoir: '18:00', finSoir: '23:00' },
]

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0')
  const m = i % 2 === 0 ? '00' : '30'
  return `${h}:${m}`
})

// Helpers

function marketRangeLabel(poste: string) {
  const p = poste.toLowerCase()
  if (p.includes('serveur')) return `Tarif minimum recommandé : 12${EURO} à 14${EURO} / h brut`
  if (p.includes('bar'))     return `Tarif minimum recommandé : 12${EURO} à 15${EURO} / h brut`
  if (p.includes('runner'))  return `Tarif minimum recommandé : 12${EURO} à 13${EURO} / h brut`
  if (p.includes('chef') || p.includes('rang')) return `Tarif minimum recommandé : 13${EURO} à 16${EURO} / h brut`
  if (p.includes('plong'))   return `Tarif minimum recommandé : 12${EURO} à 13${EURO} / h brut`
  return `Tarif minimum recommandé : 12${EURO} à 15${EURO} / h brut`
}
function marketMinimum(poste: string) {
  return poste.toLowerCase().includes('chef') || poste.toLowerCase().includes('rang') ? 13 : 12
}

function toMin(t: string): number {
  const p = t.split(':')
  return parseInt(p[0] ?? '0', 10) * 60 + parseInt(p[1] ?? '0', 10)
}
function fromMin(total: number): string {
  const n = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
}
function durationLabel(start: string, end: string): string {
  let diff = toMin(end) - toMin(start)
  if (diff <= 0) diff += 1440
  const h = Math.floor(diff / 60), m = diff % 60
  if (m === 0) return `${h}h`
  if (h === 0) return `${m}min`
  return `${h}h${m}`
}
function totalDurationLabel(debutMidi: string, finMidi: string, debutSoir: string, finSoir: string): string {
  const midi = Math.max(0, toMin(finMidi)  - toMin(debutMidi))
  const soir = Math.max(0, toMin(finSoir)  - toMin(debutSoir))
  const total = midi + soir
  const h = Math.floor(total / 60), m = total % 60
  return m === 0 ? `${h}h total` : `${h}h${m} total`
}

function formatDateLabel(d: Date) {
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}
function formatDateValue(d: Date) { return d.toISOString().slice(0, 10) }

function slotLabel(slot: MissionSlot): string {
  if (slot === 'midday')  return 'Midi'
  if (slot === 'evening') return 'Soir'
  return 'Journée (Midi + Soir)'
}

function getFriendlyAnnonceError(errorMessage: string) {
  const lower = errorMessage.toLowerCase()
  if (lower.includes("'postes' column") || lower.includes('"postes"')) {
    return "La mission n'a pas pu etre enregistree a cause d'un ancien champ devenu inutile. Le formulaire a ete corrige, reessayez."
  }
  if (lower.includes('"poste"') && lower.includes('null value')) {
    return 'Veuillez choisir au moins un poste pour la mission.'
  }
  if (lower.includes('"etablissement_id"') && lower.includes('null value')) {
    return "Veuillez configurer un etablissement avant de publier la mission."
  }
  if (lower.includes('"mission_slot"') && lower.includes('null value')) {
    return 'Veuillez choisir un type de service.'
  }
  return "Impossible d'enregistrer la mission pour le moment."
}

function validateMissionDraft(input: {
  postes: string[]
  selectedPoste: string
  customPoste: string
  date: string
  salaire: string
  etablissementId: string | null
  missionSlot: MissionSlot
  debutMidi: string
  finMidi: string
  debutSoir: string
  finSoir: string
}) {
  if (input.postes.length === 0) return 'Veuillez choisir au moins un poste.'
  if (input.selectedPoste === 'Autre' && !input.customPoste.trim()) return 'Veuillez préciser un autre poste.'
  if (!input.date) return 'Veuillez choisir une date.'
  if (!input.etablissementId) return 'Veuillez configurer un etablissement avant de publier.'
  if (!input.salaire || Number.isNaN(parseFloat(input.salaire))) return 'Veuillez renseigner une remuneration valide.'

  if (input.missionSlot === 'midday' || input.missionSlot === 'full') {
    if (!input.debutMidi || !input.finMidi) return 'Veuillez renseigner les horaires du midi.'
  }
  if (input.missionSlot === 'evening' || input.missionSlot === 'full') {
    if (!input.debutSoir || !input.finSoir) return 'Veuillez renseigner les horaires du soir.'
  }
  return null
}

// TimeBlock

interface TimeBlockProps {
  title:         string
  debut:         string
  fin:           string
  onPickDebut:   () => void
  onPickFin:     () => void
  onAdjustDebut: (delta: number) => void
  onAdjustFin:   (delta: number) => void
}

function TimeBlock({ title, debut, fin, onPickDebut, onPickFin, onAdjustDebut, onAdjustFin }: TimeBlockProps) {
  return (
    <View style={tb.wrap}>
      <View style={tb.header}>
        <Text style={tb.title}>{title}</Text>
        <Text style={tb.duration}>{durationLabel(debut, fin)}</Text>
      </View>
      <View style={tb.row}>
        <View style={tb.col}>
          <Text style={tb.label}>Début</Text>
          <TouchableOpacity style={tb.timeField} onPress={onPickDebut} activeOpacity={0.85}>
            <Text style={tb.timeValue}>{debut}</Text>
            <Text style={tb.timeMeta}>Choisir</Text>
          </TouchableOpacity>
          <View style={tb.adjustRow}>
            <TouchableOpacity style={tb.adjustBtn} onPress={() => onAdjustDebut(-30)} activeOpacity={0.82}><Text style={tb.adjustTxt}>-30 min</Text></TouchableOpacity>
            <TouchableOpacity style={tb.adjustBtn} onPress={() => onAdjustDebut( 30)} activeOpacity={0.82}><Text style={tb.adjustTxt}>+30 min</Text></TouchableOpacity>
          </View>
        </View>
        <View style={tb.col}>
          <Text style={tb.label}>Fin</Text>
          <TouchableOpacity style={tb.timeField} onPress={onPickFin} activeOpacity={0.85}>
            <Text style={tb.timeValue}>{fin}</Text>
            <Text style={tb.timeMeta}>Choisir</Text>
          </TouchableOpacity>
          <View style={tb.adjustRow}>
            <TouchableOpacity style={tb.adjustBtn} onPress={() => onAdjustFin(-30)} activeOpacity={0.82}><Text style={tb.adjustTxt}>-30 min</Text></TouchableOpacity>
            <TouchableOpacity style={tb.adjustBtn} onPress={() => onAdjustFin( 30)} activeOpacity={0.82}><Text style={tb.adjustTxt}>+30 min</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  )
}

// Main component

export default function PosterAnnonce() {
  const router = useRouter()

  const [selectedPoste,  setSelectedPoste]  = useState<string>('Barman')
  const [customPoste,    setCustomPoste]    = useState('')
  const [date,           setDate]           = useState('')
  const [customDate,     setCustomDate]     = useState(false)
  const [missionSlot,    setMissionSlot]    = useState<MissionSlot>('evening')
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>('Soir')

  // Midi block
  const [debutMidi, setDebutMidi] = useState('11:30')
  const [finMidi,   setFinMidi]   = useState('15:00')
  // Soir block
  const [debutSoir, setDebutSoir] = useState('18:00')
  const [finSoir,   setFinSoir]   = useState('23:00')

  const [salaire,        setSalaire]        = useState('12')
  const [description,    setDescription]    = useState('')
  const [loading,        setLoading]        = useState(false)
  const [patronId,       setPatronId]       = useState('')
  const [etablissements, setEtablissements] = useState<Etablissement[]>([])
  const [selectedEtablissementId, setSelectedEtablissementId] = useState<string>('')
  const [showEtablissementPicker, setShowEtablissementPicker] = useState(false)

  // picker: which field is being picked
  type PickerTarget = 'debut-midi' | 'fin-midi' | 'debut-soir' | 'fin-soir'
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null)

  const resolvedPostes = normalizeAnnoncePostes(
    selectedPoste === 'Autre' ? customPoste.trim() : selectedPoste
  )
  const posteLabel = buildAnnoncePosteLabel(resolvedPostes)
  const salaireValue = parseFloat(salaire || '0')
  const isBelowMin   = !Number.isNaN(salaireValue) && salaireValue < marketMinimum(posteLabel || 'Barman')
  const selectedEtablissement = etablissements.find((item) => item.id === selectedEtablissementId) ?? null

  const isFull    = missionSlot === 'full'
  const isMidi    = missionSlot === 'midday'
  const isSoir    = missionSlot === 'evening'

  const dateOptions = useMemo(() => Array.from({ length: 4 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i)
    return {
      label: i === 0 ? "Aujourd'hui" : i === 1 ? 'Demain' : formatDateLabel(d),
      value: formatDateValue(d),
    }
  }), [])

  useEffect(() => { chargerPatron() }, [])
  useEffect(() => { if (!date) setDate(dateOptions[0]?.value ?? '') }, [date, dateOptions])

  const chargerPatron = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('patrons').select('id').eq('id', user.id).single()
    if (data) {
      setPatronId(data.id)
      const nextEtablissements = await fetchEtablissementsForPatron(data.id)
      setEtablissements(nextEtablissements)
      const preferredEtablissement = getPreferredEtablissement(nextEtablissements)
      if (preferredEtablissement) setSelectedEtablissementId(preferredEtablissement.id)
    }
  }

  const applyPreset = (preset: Preset) => {
    setSelectedPreset(preset.label)
    setMissionSlot(preset.slot)
    if (preset.debutMidi) setDebutMidi(preset.debutMidi)
    if (preset.finMidi)   setFinMidi(preset.finMidi)
    if (preset.debutSoir) setDebutSoir(preset.debutSoir)
    if (preset.finSoir)   setFinSoir(preset.finSoir)
  }

  const adjustTime = (field: PickerTarget, delta: number) => {
    const map: Record<PickerTarget, [string, (v: string) => void]> = {
      'debut-midi': [debutMidi, setDebutMidi],
      'fin-midi':   [finMidi,   setFinMidi],
      'debut-soir': [debutSoir, setDebutSoir],
      'fin-soir':   [finSoir,   setFinSoir],
    }
    const [cur, setter] = map[field]
    setter(fromMin(toMin(cur) + delta))
  }

  const selectPickerValue = (value: string) => {
    if (!pickerTarget) return
    adjustTime(pickerTarget, 0) // no-op, just use setter directly
    const setters: Record<PickerTarget, (v: string) => void> = {
      'debut-midi': setDebutMidi,
      'fin-midi':   setFinMidi,
      'debut-soir': setDebutSoir,
      'fin-soir':   setFinSoir,
    }
    setters[pickerTarget](value)
    setPickerTarget(null)
  }

  const getCurrentPickerValue = (): string => {
    if (!pickerTarget) return '18:00'
    const map: Record<PickerTarget, string> = {
      'debut-midi': debutMidi,
      'fin-midi':   finMidi,
      'debut-soir': debutSoir,
      'fin-soir':   finSoir,
    }
    return map[pickerTarget]
  }

  const pickerTitle = (): string => {
    if (!pickerTarget) return ''
    if (pickerTarget === 'debut-midi') return 'Début du service midi'
    if (pickerTarget === 'fin-midi')   return 'Fin du service midi'
    if (pickerTarget === 'debut-soir') return 'Debut du service soir'
    return 'Fin du service soir'
  }

  const notifierServeursProches = async (coords: { lat: number; lng: number } | null) => {
    try {
      if (!coords) return
      const { data: serveurs } = await supabase.from('serveurs').select('id, lat, lng, rayon').eq('disponible', true)
      if (!serveurs || serveurs.length === 0) return
      const proches = (serveurs as any[]).filter(s => {
        if (!s.lat || !s.lng) return false
        return haversineKm(s.lat, s.lng, coords.lat, coords.lng) <= (s.rayon ?? 20)
      })
      if (proches.length > 0) {
        await envoyerNotificationLocale(
          'Nouvelle mission a proximite',
          `Un patron recherche ${posteLabel || 'du renfort'} a ${selectedEtablissement?.ville ?? ''} le ${date}.`
        )
      }
    } catch (e) { console.log('notifierServeursProches error', e) }
  }

  const handlePublier = async () => {
    const etablissement = selectedEtablissement

    const validationError = validateMissionDraft({
      postes: resolvedPostes,
      selectedPoste,
      customPoste,
      date,
      salaire,
      etablissementId: etablissement?.id ?? null,
      missionSlot,
      debutMidi,
      finMidi,
      debutSoir,
      finSoir,
    })

    if (validationError) {
      Alert.alert('Erreur', validationError)
      return
    }

    if (!etablissement) {
      Alert.alert('Erreur', "Veuillez choisir un établissement avant de publier.")
      return
    }

    setLoading(true)
    const coords = etablissement.lat != null && etablissement.lng != null
      ? { lat: etablissement.lat, lng: etablissement.lng }
      : await geocoderVille(etablissement.ville)

    // heure_debut / heure_fin = legacy fields for display / compatibility
    const heureDebut = isMidi || isFull ? debutMidi : debutSoir
    const heureFin   = isSoir || isFull ? finSoir   : finMidi
    setLoading(false)

    router.push({
      pathname: '/serveurs-disponibles',
      params: {
        preview: '1',
        poste: posteLabel,
        postes: resolvedPostes.join('|'),
        date,
        heureDebut,
        heureFin,
        heureDebutMidi: isMidi || isFull ? debutMidi : '',
        heureFinMidi: isMidi || isFull ? finMidi : '',
        heureDebutSoir: isSoir || isFull ? debutSoir : '',
        heureFinSoir: isSoir || isFull ? finSoir : '',
        missionSlot,
        salaire,
        description,
        ville: etablissement.ville,
        etablissementId: etablissement.id,
        lat: coords?.lat != null ? String(coords.lat) : '',
        lng: coords?.lng != null ? String(coords.lng) : '',
      },
    })
  }

  const selectPoste = (v: string) => {
    if (v === selectedPoste) return
    setSelectedPoste(v)
    if (v !== 'Autre') setCustomPoste('')
  }

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#F7F4EE" />

      <ScrollView style={s.container} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={s.back} onPress={() => router.back()} activeOpacity={0.75}>
          <Text style={s.backText}>Retour</Text>
        </TouchableOpacity>

        <Text style={s.title}>Nouvelle mission</Text>
        <Text style={s.subtitle}>Créez votre recherche en quelques étapes</Text>

        {/* POSTE */}
        <View style={s.sectionCard}>
          <Text style={s.sectionEyebrow}>Mission</Text>
          <Text style={s.sectionTitle}>Quel renfort vous faut-il ?</Text>

          <Text style={s.label}>Poste recherché *</Text>
          <View style={s.chipsWrap}>
            {POSTE_OPTIONS.map(o => {
              const sel = selectedPoste === o
              return (
                <TouchableOpacity key={o} style={[s.chip, sel && s.chipActive]} onPress={() => selectPoste(o)} activeOpacity={0.82}>
                  <Text style={[s.chipText, sel && s.chipTextActive]}>{o}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
          {selectedPoste === 'Autre' && (
            <TextInput style={s.input} placeholder="Précisez un autre poste" placeholderTextColor="#8D857B" value={customPoste} onChangeText={setCustomPoste} />
          )}
          {posteLabel ? <Text style={s.selectionSummary}>{posteLabel}</Text> : null}

          <Text style={s.label}>Établissement utilisé</Text>
          <View style={s.etablissementInlineCard}>
            <View style={{ flex: 1 }}>
              <Text style={s.etablissementInlineName}>{selectedEtablissement?.nom ?? 'Aucun etablissement configure'}</Text>
              <Text style={s.etablissementInlineMeta}>
                {selectedEtablissement ? `${selectedEtablissement.ville}${selectedEtablissement.adresse ? ` · ${selectedEtablissement.adresse}` : ''}` : 'Ajoutez un etablissement dans votre profil patron avant de publier'}
              </Text>
            </View>
            {etablissements.length > 1 ? (
              <TouchableOpacity style={s.inlineActionBtn} onPress={() => setShowEtablissementPicker((prev) => !prev)} activeOpacity={0.82}>
                <Text style={s.inlineActionTxt}>{showEtablissementPicker ? 'Fermer' : 'Changer'}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={s.inlineActionBtn} onPress={() => router.push('/mes-etablissements')} activeOpacity={0.82}>
                <Text style={s.inlineActionTxt}>{selectedEtablissement ? 'Gerer' : 'Ajouter'}</Text>
              </TouchableOpacity>
            )}
          </View>
          {showEtablissementPicker && etablissements.length > 1 ? (
            <View style={s.etablissementPickerWrap}>
              {etablissements.map((item) => {
                const selected = selectedEtablissementId === item.id
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[s.etablissementPickerItem, selected && s.etablissementPickerItemActive]}
                    onPress={() => {
                      setSelectedEtablissementId(item.id)
                      setShowEtablissementPicker(false)
                    }}
                    activeOpacity={0.84}
                  >
                    <Text style={[s.etablissementPickerName, selected && s.etablissementPickerNameActive]}>{item.nom}</Text>
                    <Text style={[s.etablissementPickerMeta, selected && s.etablissementPickerMetaActive]}>
                      {item.ville}{item.adresse ? ` · ${item.adresse}` : ''}
                    </Text>
                  </TouchableOpacity>
                )
              })}
              <TouchableOpacity style={s.manageLinkBtn} onPress={() => router.push('/mes-etablissements')} activeOpacity={0.8}>
                <Text style={s.manageLinkTxt}>Gerer mes etablissements</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {etablissements.length === 0 ? (
            <TouchableOpacity style={s.manageLinkBtn} onPress={() => router.push('/mes-etablissements')} activeOpacity={0.8}>
              <Text style={s.manageLinkTxt}>Ajouter mon premier etablissement</Text>
            </TouchableOpacity>
          ) : null}

          {/* DATE */}
          <Text style={s.label}>Date de la mission *</Text>
          <View style={s.chipsWrap}>
            {dateOptions.map(o => {
              const sel = date === o.value && !customDate
              return (
                <TouchableOpacity key={o.value} style={[s.chip, sel && s.chipActive]} onPress={() => { setCustomDate(false); setDate(o.value) }} activeOpacity={0.82}>
                  <Text style={[s.chipText, sel && s.chipTextActive]}>{o.label}</Text>
                </TouchableOpacity>
              )
            })}
            <TouchableOpacity style={[s.chip, customDate && s.chipActive]} onPress={() => setCustomDate(true)} activeOpacity={0.82}>
              <Text style={[s.chipText, customDate && s.chipTextActive]}>Autre</Text>
            </TouchableOpacity>
          </View>
          {customDate && (
            <TextInput style={s.input} placeholder="AAAA-MM-JJ" placeholderTextColor="#8D857B" value={date} onChangeText={setDate} />
          )}

          {/* HORAIRES - preset buttons â”€â”€ */}
          <Text style={s.label}>Type de service *</Text>
          <View style={s.chipsWrap}>
            {PRESETS.map((p, index) => {
              const sel = selectedPreset === p.label
              return (
                <TouchableOpacity key={`${p.label}-${index}`} style={[s.chip, sel && s.chipActive]} onPress={() => applyPreset(p)} activeOpacity={0.82}>
                  <Text style={[s.chipText, sel && s.chipTextActive]}>{p.label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>

          {/* Slot badge */}
          <View style={s.slotBadge}>
            <Text style={s.slotBadgeTxt}>Creneau : <Text style={s.slotBadgeVal}>{slotLabel(missionSlot)}</Text></Text>
          </View>

          {/* TIME BLOCKS */}
          {(isMidi || isFull) && (
            <TimeBlock
              title="Service du midi"
              debut={debutMidi}
              fin={finMidi}
              onPickDebut={() => setPickerTarget('debut-midi')}
              onPickFin={()   => setPickerTarget('fin-midi')}
              onAdjustDebut={d => adjustTime('debut-midi', d)}
              onAdjustFin={d   => adjustTime('fin-midi',   d)}
            />
          )}

          {/* Separator for Journee */}
          {isFull && (
            <View style={s.coupureWrap}>
              <View style={s.coupureLine} />
              <Text style={s.coupureTxt}>Coupure</Text>
              <View style={s.coupureLine} />
            </View>
          )}

          {(isSoir || isFull) && (
            <TimeBlock
              title="Service du soir"
              debut={debutSoir}
              fin={finSoir}
              onPickDebut={() => setPickerTarget('debut-soir')}
              onPickFin={()   => setPickerTarget('fin-soir')}
              onAdjustDebut={d => adjustTime('debut-soir', d)}
              onAdjustFin={d   => adjustTime('fin-soir',   d)}
            />
          )}

          {/* Total for Journee */}
          {isFull && (
            <View style={s.totalRow}>
              <Text style={s.totalTxt}>{totalDurationLabel(debutMidi, finMidi, debutSoir, finSoir)}</Text>
            </View>
          )}
        </View>

        {/* REMUNERATION */}
        <View style={s.sectionCard}>
          <Text style={s.sectionEyebrow}>Remuneration</Text>
          <Text style={s.sectionTitle}>Remuneration</Text>
          <Text style={s.label}>Salaire horaire brut *</Text>
          <View style={s.salaryCard}>
            <Text style={s.salaryValue}>{`${salaire || '12'}${EURO} / h brut`}</Text>
          </View>
          <Text style={s.marketHint}>{isBelowMin ? 'Ce tarif est inferieur au minimum recommande.' : marketRangeLabel(posteLabel || 'Barman')}</Text>
          {isBelowMin && <Text style={s.marketBoost}>Augmentez votre tarif pour recevoir plus de candidatures.</Text>}
          <View style={s.chipsWrap}>
            {SALAIRE_OPTIONS.map(o => (
              <TouchableOpacity key={o} style={[s.chip, salaire === o && s.chipActive]} onPress={() => setSalaire(o)} activeOpacity={0.82}>
                <Text style={[s.chipText, salaire === o && s.chipTextActive]}>{`${o}${EURO}/h`}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={s.input} placeholder="Personnaliser le salaire" placeholderTextColor="#8D857B" keyboardType="decimal-pad" value={salaire} onChangeText={setSalaire} />
        </View>

        {/* DETAILS */}
        <View style={s.sectionCard}>
          <Text style={s.sectionEyebrow}>Details</Text>
          <Text style={s.sectionTitle}>Details de la mission</Text>
          <Text style={s.infoPill}>
            {selectedEtablissement ? `Lieu ${selectedEtablissement.nom} - ${selectedEtablissement.ville}` : 'Configurez un etablissement pour publier'}
          </Text>
          <Text style={s.label}>Description</Text>
          <TextInput
            style={[s.input, s.inputMultiline]}
            placeholder="Brief, tenue demandee, rythme du service..."
            placeholderTextColor="#8D857B"
            multiline
            numberOfLines={5}
            value={description}
            onChangeText={setDescription}
          />
        </View>
      </ScrollView>

      {/* CTA */}
      <View style={s.stickyBar}>
        <TouchableOpacity style={[s.button, loading && s.buttonDisabled]} onPress={handlePublier} disabled={loading} activeOpacity={0.88}>
          <Text style={s.buttonText}>{loading ? 'Publication...' : 'Voir les profils disponibles'}</Text>
        </TouchableOpacity>
        <Text style={s.reassurance}>Paiement uniquement si la mission est realisee</Text>
      </View>

      {/* TIME PICKER MODAL */}
      <Modal visible={pickerTarget !== null} transparent animationType="slide" onRequestClose={() => setPickerTarget(null)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setPickerTarget(null)} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>{pickerTitle()}</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.modalList}>
              {TIME_OPTIONS.map(v => {
                const sel = getCurrentPickerValue() === v
                return (
                  <TouchableOpacity key={v} style={[s.modalOption, sel && s.modalOptionActive]} onPress={() => selectPickerValue(v)} activeOpacity={0.82}>
                    <Text style={[s.modalOptionText, sel && s.modalOptionTextActive]}>{v}</Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}

// TimeBlock styles

const tb = StyleSheet.create({
  wrap:       { borderWidth: 1, borderColor: '#E7E0D5', borderRadius: 18, backgroundColor: '#FCF9F4', padding: 14, marginBottom: 12 },
  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title:      { fontSize: 14, fontWeight: '800', color: '#171614' },
  duration:   { fontSize: 15, fontWeight: '800', color: '#C46A3C' },
  row:        { flexDirection: 'row', gap: 12 },
  col:        { flex: 1 },
  label:      { fontSize: 13, color: '#5F574C', fontWeight: '700', marginBottom: 8 },
  timeField:  { borderWidth: 1, borderColor: '#E2D9CC', borderRadius: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8 },
  timeValue:  { fontSize: 22, color: '#171614', fontWeight: '800', letterSpacing: -0.5, marginBottom: 2 },
  timeMeta:   { fontSize: 12, color: '#8D857B', fontWeight: '600' },
  adjustRow:  { flexDirection: 'row', gap: 6 },
  adjustBtn:  { flex: 1, borderWidth: 1, borderColor: '#E5DED2', borderRadius: 10, backgroundColor: '#FFFFFF', paddingVertical: 9, alignItems: 'center' },
  adjustTxt:  { fontSize: 11, color: '#5F574C', fontWeight: '700' },
})

// Main styles

const s = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: '#F7F4EE' },
  container:{ flex: 1 },
  content:  { paddingHorizontal: 20, paddingTop: 58, paddingBottom: 170 },
  back:     { alignSelf: 'flex-start', marginBottom: 22 },
  backText: { fontSize: 15, color: '#C46A3C', fontWeight: '700' },
  title:    { fontSize: 30, fontWeight: '800', color: '#171614', marginBottom: 6, letterSpacing: -0.6 },
  subtitle: { fontSize: 15, lineHeight: 22, color: '#7B7368', marginBottom: 24 },

  sectionCard:    { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: '#EDE8DF', shadowColor: '#2B2118', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 6 }, shadowRadius: 18, elevation: 2 },
  sectionEyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1, color: '#A39A8E', textTransform: 'uppercase', marginBottom: 6 },
  sectionTitle:   { fontSize: 19, fontWeight: '800', color: '#171614', letterSpacing: -0.3, marginBottom: 16 },
  label:          { fontSize: 13, fontWeight: '700', color: '#171614', marginBottom: 8 },

  chipsWrap:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip:           { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14, borderWidth: 1, borderColor: '#E5DED2', backgroundColor: '#FFFFFF' },
  chipActive:     { backgroundColor: '#C46A3C', borderColor: '#C46A3C' },
  chipText:       { fontSize: 14, color: '#5F574C', fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '700' },
  selectionSummary:{ fontSize: 13, color: '#5F574C', fontWeight: '700', marginBottom: 14 },
  etablissementInlineCard:{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFCF8', borderRadius: 16, borderWidth: 1, borderColor: '#E5DED2', paddingHorizontal: 14, paddingVertical: 13, marginBottom: 10 },
  etablissementInlineName:{ fontSize: 14, color: '#171614', fontWeight: '800', marginBottom: 4 },
  etablissementInlineMeta:{ fontSize: 12, color: '#8D857B', fontWeight: '600', lineHeight: 17 },
  inlineActionBtn:{ borderRadius: 12, borderWidth: 1, borderColor: '#F5C9A9', backgroundColor: '#FEF3EB', paddingHorizontal: 12, paddingVertical: 10 },
  inlineActionTxt:{ fontSize: 12, color: '#C46A3C', fontWeight: '800' },
  etablissementPickerWrap:{ gap: 8, marginBottom: 10 },
  etablissementPickerItem:{ backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E5DED2', paddingHorizontal: 14, paddingVertical: 12 },
  etablissementPickerItemActive:{ backgroundColor: '#FEF3EB', borderColor: '#F5C9A9' },
  etablissementPickerName:{ fontSize: 13, color: '#171614', fontWeight: '800', marginBottom: 4 },
  etablissementPickerNameActive:{ color: '#C46A3C' },
  etablissementPickerMeta:{ fontSize: 12, color: '#8D857B', fontWeight: '600' },
  etablissementPickerMetaActive:{ color: '#9F542D' },
  manageLinkBtn:{ alignSelf: 'flex-start', marginBottom: 18 },
  manageLinkTxt:{ fontSize: 13, color: '#C46A3C', fontWeight: '700' },

  slotBadge:    { backgroundColor: '#F0F8F3', borderWidth: 1, borderColor: '#C0DEC8', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16 },
  slotBadgeTxt: { fontSize: 12, color: '#5A7A62', fontWeight: '600' },
  slotBadgeVal: { color: '#2E8B57', fontWeight: '800' },

  coupureWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  coupureLine: { flex: 1, height: 1, backgroundColor: '#E5DED2' },
  coupureTxt:  { fontSize: 12, color: '#A39A8E', fontWeight: '700' },

  totalRow: { backgroundColor: '#FEF3EB', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginTop: 4, alignItems: 'center' },
  totalTxt: { fontSize: 14, color: '#C46A3C', fontWeight: '800' },

  input:          { borderWidth: 1, borderColor: '#E5DED2', borderRadius: 16, paddingHorizontal: 15, paddingVertical: 14, fontSize: 15, color: '#171614', backgroundColor: '#FFFEFC', marginBottom: 2 },
  inputMultiline: { minHeight: 120, textAlignVertical: 'top' },

  salaryCard:  { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E5DED2', padding: 18, marginBottom: 14 },
  salaryValue: { fontSize: 30, fontWeight: '800', color: '#171614', letterSpacing: -0.7, marginBottom: 4 },
  infoPill:    { fontSize: 14, color: '#5F574C', paddingHorizontal: 2, paddingVertical: 4, marginBottom: 14, fontWeight: '700' },
  marketHint:  { fontSize: 13, color: '#7B7368', marginBottom: 6, fontWeight: '600' },
  marketBoost: { fontSize: 13, color: '#C46A3C', marginBottom: 14, fontWeight: '700' },

  stickyBar:      { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(247,244,238,0.98)', borderTopWidth: 1, borderTopColor: '#E8DFD4', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30 },
  button:         { backgroundColor: '#C46A3C', paddingVertical: 17, borderRadius: 16, alignItems: 'center', shadowColor: '#C46A3C', shadowOpacity: 0.22, shadowOffset: { width: 0, height: 8 }, shadowRadius: 18, elevation: 4 },
  buttonDisabled: { backgroundColor: '#D4C4B8', shadowOpacity: 0, elevation: 0 },
  buttonText:     { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  reassurance:    { marginTop: 10, textAlign: 'center', fontSize: 12, color: '#7B7368', fontWeight: '600' },

  modalOverlay:      { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,22,20,0.28)' },
  modalBackdrop:     { flex: 1 },
  modalSheet:        { backgroundColor: '#FFFCF8', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10, paddingHorizontal: 20, paddingBottom: 28, maxHeight: '62%' },
  modalHandle:       { alignSelf: 'center', width: 44, height: 5, borderRadius: 999, backgroundColor: '#DDD3C7', marginBottom: 14 },
  modalTitle:        { fontSize: 17, fontWeight: '800', color: '#171614', textAlign: 'center', marginBottom: 14 },
  modalList:         { paddingBottom: 8, gap: 8 },
  modalOption:       { borderWidth: 1, borderColor: '#E7DED2', borderRadius: 16, backgroundColor: '#FFFFFF', paddingVertical: 15, alignItems: 'center' },
  modalOptionActive: { backgroundColor: '#C46A3C', borderColor: '#C46A3C' },
  modalOptionText:       { fontSize: 17, color: '#171614', fontWeight: '700' },
  modalOptionTextActive: { color: '#FFFFFF' },
})
