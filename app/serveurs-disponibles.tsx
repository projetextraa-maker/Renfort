import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { missionMatchesRequestedPostes, normalizeAnnoncePostes } from '../lib/annonce-postes'
import { ANNONCE_COMPAT_SELECT, normalizeAnnonceRecord } from '../lib/annonce-read'
import { fetchEtablissementById } from '../lib/etablissements'
import { hasValidCoordinates, haversineKm } from '../lib/location-distance'
import { isWorkerEligibleForMatching } from '../lib/mission-hiring'
import { getPresenceRate } from '../lib/serveur-presence'
import { fetchServerAvailabilityMap, getServerBusySlotMessage, isServerAvailable } from '../lib/server-availability'
import { type MissionSlot } from '../lib/serveur-disponibilites'
import { compareServeurRanking, computeRecommendationScore, computeServeurGlobalScore } from '../lib/serveur-score'
import { fetchServeurExperiencePostesMap } from '../lib/serveur-experiences-api'
import { computeServeurMissionStatsMap, getServeurExperienceBadgeLabel } from '../lib/serveur-stats'
import { supabase } from '../lib/supabase'

interface Serveur {
  id: string
  prenom: string
  nom: string
  ville: string
  disponible: boolean
  score: number | null
  note?: number | null
  rating?: number | null
  taux_presence?: number | null
  missions_realisees: number | null
  missions_annulees: number | null
  photo_url: string | null
  lat: number | null
  lng: number | null
  distance_km?: number | null
  score_global?: number | null
  recommendation_score?: number | null
  experience_postes?: string[]
}

const MAX_DISTANCE_KM = 50

function parseNum(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getRating(serveur: Serveur): number | null {
  return parseNum(serveur.score ?? serveur.note ?? serveur.rating)
}

function isGenericServeurRequested(requestedPostes: string[]): boolean {
  const normalized = normalizeAnnoncePostes(requestedPostes).map((item) => item.trim().toLowerCase())
  return normalized.length === 1 && normalized[0] === 'serveur'
}

function initiales(prenom: string, nom: string): string {
  return `${prenom?.[0] ?? ''}${nom?.[0] ?? ''}`.toUpperCase()
}

function formatDateFr(dateStr: string): string {
  if (!dateStr) return ''
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  try {
    const date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])))
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  } catch {
    return dateStr
  }
}

function slotLabel(slot: MissionSlot): string {
  if (slot === 'midday') return 'Midi'
  if (slot === 'evening') return 'Soir'
  return 'Journée'
}

function compareServeursForDisplay(
  a: Serveur & { _matchesPoste?: boolean },
  b: Serveur & { _matchesPoste?: boolean }
): number {
  const rolePriorityDiff = Number(Boolean(b._matchesPoste)) - Number(Boolean(a._matchesPoste))
  if (rolePriorityDiff !== 0) return rolePriorityDiff

  const noteA = getRating(a) ?? -1
  const noteB = getRating(b) ?? -1
  if (noteB !== noteA) return noteB - noteA

  const distanceA = a.distance_km == null ? Number.POSITIVE_INFINITY : a.distance_km
  const distanceB = b.distance_km == null ? Number.POSITIVE_INFINITY : b.distance_km
  if (distanceA !== distanceB) return distanceA - distanceB

  return compareServeurRanking(
    {
      tauxPresence: a.taux_presence ?? null,
      missionsRealisees: a.missions_realisees ?? 0,
      noteMoyenne: getRating(a),
      distanceKm: a.distance_km ?? null,
    },
    {
      tauxPresence: b.taux_presence ?? null,
      missionsRealisees: b.missions_realisees ?? 0,
      noteMoyenne: getRating(b),
      distanceKm: b.distance_km ?? null,
    }
  )
}

function getFriendlyDemandesError(errorMessage: string | null | undefined): string {
  const lower = String(errorMessage ?? '').toLowerCase()
  if (lower.includes('replacement_for_engagement_id') && lower.includes('could not find')) {
    return "Le mode remplacement n'est pas encore configuré dans la base."
  }
  if (lower.includes('row-level security') || lower.includes('permission denied')) {
    return "L'envoi de la demande est refusé par les règles d'accès de la base."
  }
  return "Impossible d'envoyer les demandes pour le moment."
}

function parseSelectedIds(value: unknown): string[] {
  return String(value ?? '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
}

const C = {
  bg: '#F6F3EE',
  card: '#FFFFFF',
  border: '#EAEAEA',
  green: '#2F8F5B',
  greenBg: '#EEF8F2',
  greenBd: '#D7EBDD',
  greenDk: '#163725',
  text: '#171717',
  textSub: '#5C5C5C',
  muted: '#8C8C8C',
  soft: '#F3F0EA',
}

const FR = {
  back: 'Retour',
  eyebrow: 'Profils disponibles',
  title: 'Sélectionnez vos profils',
  intro:
    'Consultez, comparez et sélectionnez des profils avant publication. Les autres serveurs pourront aussi postuler une fois l’annonce publiée.',
  shortlist: 'Shortlist',
  shortlistEmpty: 'Aucun profil sélectionné',
  shortlistHint: 'Ajoutez des profils pour préparer votre shortlist.',
  shortlistActiveHint: 'Ils seront contactés à la publication.',
  searchPlaceholder: 'Nom, ville...',
  aroundCity: 'Autour de',
  missionOrigin: 'établissement de la mission',
  requestedRole: 'Poste recherché',
  noCity: 'Ville non renseignée',
  presence: 'présence',
  notRated: 'Pas encore noté',
  profile: 'Voir le profil',
  addSelection: 'Ajouter à la sélection',
  removeSelection: 'Retirer de la sélection',
  selected: 'Sélectionné',
  publishedHint: 'Les autres serveurs pourront aussi postuler après publication.',
  draftHint: 'Choisissez des profils avant de publier l’annonce.',
  publish: 'Publier l’annonce',
  backWithoutPublishing: 'Revenir sans publier',
  noResult: 'Aucun serveur disponible pour ce créneau',
  noResultHint: 'Modifiez les horaires pour élargir les profils compatibles.',
  availableNow: 'Disponible pour ce créneau',
  availableOn: 'Disponible le',
  readyLabel: 'Prêt à publier',
  shortlistProgress: 'profil sélectionné',
  shortlistProgressPlural: 'profils sélectionnés',
  chanceHigh: 'Très forte chance de réponse',
  chanceMedium: '2 profils · chance élevée',
  chanceOk: 'Chance de réponse correcte',
  contactOne: 'Contacter 1 profil',
  contactMany: 'Contacter',
  selectAtLeastOne: 'Sélectionnez au moins 1 profil',
  publishedTitle: 'Annonce publiée',
  publishedBody: 'La mission est maintenant diffusée aux serveurs disponibles.',
  requestsSentTitle: 'Profils contactés',
  loadingPublish: 'Publication...',
  newBadge: 'Nouveau',
  compatibles: 'compatibles',
  mission: 'Mission',
  suitableProfiles: 'Profils pertinents',
  footerHint: 'Les autres serveurs pourront aussi postuler après publication.',
  footerHintEmpty: 'Sélection facultative avant publication.',
  experience: 'Expérience',
}

const EMPTY_FR = {
  title: 'Aucun serveur disponible pour ce créneau',
  adjustMission: 'Modifier les horaires',
}

export default function ServeursDisponibles() {
  const router = useRouter()
  const params = useLocalSearchParams()

  const annonceIdParam = Array.isArray(params.annonceId) ? params.annonceId[0] : params.annonceId
  const replaceEngagementIdParam = Array.isArray(params.replaceEngagementId) ? params.replaceEngagementId[0] : params.replaceEngagementId
  const previewParam = Array.isArray(params.preview) ? params.preview[0] : params.preview
  const isPreviewMission = previewParam === '1' && !annonceIdParam

  const previewPosteParam = Array.isArray(params.poste) ? params.poste[0] : params.poste
  const previewPostesParam = Array.isArray(params.postes) ? params.postes[0] : params.postes
  const previewDateParam = Array.isArray(params.date) ? params.date[0] : params.date
  const previewHeureDebutParam = Array.isArray(params.heureDebut) ? params.heureDebut[0] : params.heureDebut
  const previewHeureFinParam = Array.isArray(params.heureFin) ? params.heureFin[0] : params.heureFin
  const previewHeureDebutMidiParam = Array.isArray(params.heureDebutMidi) ? params.heureDebutMidi[0] : params.heureDebutMidi
  const previewHeureFinMidiParam = Array.isArray(params.heureFinMidi) ? params.heureFinMidi[0] : params.heureFinMidi
  const previewHeureDebutSoirParam = Array.isArray(params.heureDebutSoir) ? params.heureDebutSoir[0] : params.heureDebutSoir
  const previewHeureFinSoirParam = Array.isArray(params.heureFinSoir) ? params.heureFinSoir[0] : params.heureFinSoir
  const previewMissionSlotParam = Array.isArray(params.missionSlot) ? params.missionSlot[0] : params.missionSlot
  const previewSalaireParam = Array.isArray(params.salaire) ? params.salaire[0] : params.salaire
  const previewDescriptionParam = Array.isArray(params.description) ? params.description[0] : params.description
  const previewVilleParam = Array.isArray(params.ville) ? params.ville[0] : params.ville
  const previewEtablissementIdParam = Array.isArray(params.etablissementId) ? params.etablissementId[0] : params.etablissementId
  const previewLatParam = Array.isArray(params.lat) ? params.lat[0] : params.lat
  const previewLngParam = Array.isArray(params.lng) ? params.lng[0] : params.lng
  const selectedIdsParam = Array.isArray(params.selectedIds) ? params.selectedIds[0] : params.selectedIds

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [patronVille, setPatronVille] = useState<string | null>(null)
  const [searchOrigin, setSearchOrigin] = useState<'etablissement' | 'patron' | 'legacy_annonce' | null>(null)
  const [annonceStatus, setAnnonceStatus] = useState<string | null>(null)
  const [compatibles, setCompatibles] = useState<Serveur[]>([])
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [recommendedId, setRecommendedId] = useState<string | null>(null)
  const [missionInfo, setMissionInfo] = useState<{
    date: string
    heure_debut: string
    heure_fin: string
    slot: MissionSlot
    postes: string[]
  } | null>(null)

  const barAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.spring(barAnim, {
      toValue: selection.size > 0 ? 1 : 0,
      useNativeDriver: true,
      tension: 100,
      friction: 12,
    }).start()
  }, [barAnim, selection.size])

  useEffect(() => {
    if (typeof selectedIdsParam !== 'string') return
    setSelection(new Set(parseSelectedIds(selectedIdsParam)))
  }, [selectedIdsParam])

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/')
        return
      }

      const { data: patron } = await supabase
        .from('patrons')
        .select('ville, lat, lng')
        .eq('id', user.id)
        .single()

      let searchLat: number | null = patron?.lat ?? null
      let searchLng: number | null = patron?.lng ?? null
      let searchVille: string | null = patron?.ville ?? null
      let missionDate = ''
      let missionDebut = ''
      let missionFin = ''
      let missionSlot: MissionSlot = 'evening'
      let requestedPostes: string[] = []

      if (patron?.ville) setPatronVille(patron.ville)
      if (patron) setSearchOrigin('patron')

      if (annonceIdParam && typeof annonceIdParam === 'string') {
        const { data: annonceData } = await supabase
          .from('annonces')
          .select(ANNONCE_COMPAT_SELECT)
          .eq('id', annonceIdParam)
          .maybeSingle()

        if (annonceData) {
          const annonce = normalizeAnnonceRecord(annonceData as any)
          setAnnonceStatus(annonce.statut ?? null)
          if (annonce.etablissement_id) {
            const etablissement = await fetchEtablissementById(annonce.etablissement_id)
            if (etablissement) {
              searchLat = etablissement.lat ?? searchLat
              searchLng = etablissement.lng ?? searchLng
              searchVille = etablissement.ville ?? searchVille
              setPatronVille(etablissement.ville ?? patron?.ville ?? null)
              setSearchOrigin('etablissement')
            }
          } else if (annonce.lat != null && annonce.lng != null) {
            searchLat = annonce.lat
            searchLng = annonce.lng
            searchVille = annonce.ville || searchVille
            setPatronVille(annonce.ville || patron?.ville || null)
            setSearchOrigin('legacy_annonce')
          }

          missionDate = annonce.date ?? ''
          missionDebut = annonce.heure_debut ?? ''
          missionFin = annonce.heure_fin ?? ''
          requestedPostes = normalizeAnnoncePostes(annonce.poste)
          if (annonce.mission_slot === 'midday' || annonce.mission_slot === 'evening' || annonce.mission_slot === 'full') {
            missionSlot = annonce.mission_slot
          }
        }
      } else if (isPreviewMission) {
        setAnnonceStatus('draft')
        searchLat = parseNum(previewLatParam)
        searchLng = parseNum(previewLngParam)
        searchVille = typeof previewVilleParam === 'string' ? previewVilleParam : patron?.ville ?? null
        setPatronVille(searchVille)
        setSearchOrigin(searchLat != null && searchLng != null ? 'etablissement' : 'patron')

        missionDate = typeof previewDateParam === 'string' ? previewDateParam : ''
        missionDebut = typeof previewHeureDebutParam === 'string' ? previewHeureDebutParam : ''
        missionFin = typeof previewHeureFinParam === 'string' ? previewHeureFinParam : ''
        requestedPostes = String(previewPostesParam ?? '')
          .split('|')
          .map((item) => item.trim())
          .filter(Boolean)
        if (requestedPostes.length === 0) requestedPostes = normalizeAnnoncePostes(previewPosteParam)
        if (previewMissionSlotParam === 'midday' || previewMissionSlotParam === 'evening' || previewMissionSlotParam === 'full') {
          missionSlot = previewMissionSlotParam
        }
      }

      if (missionDate && missionDebut && missionFin) {
        setMissionInfo({
          date: missionDate,
          heure_debut: missionDebut,
          heure_fin: missionFin,
          slot: missionSlot,
          postes: requestedPostes,
        })
      }

      const { data: srvs } = await supabase.rpc('get_ranked_serveurs_simple')
      const rankedMap = Object.fromEntries(
        ((srvs as any[]) ?? []).map((row) => [row.id ?? row.serveur_id, row]).filter(([id]) => Boolean(id))
      )

      const { data: tableData } = await supabase.from('serveurs').select('*')
      const hasOriginCoords = hasValidCoordinates(searchLat, searchLng)
      const ids = ((tableData ?? []) as any[]).map((src) => String(src.id))
      const statsMap = await computeServeurMissionStatsMap(ids)
      const experiencePostesMap = await fetchServeurExperiencePostesMap(ids)
      const availabilityMap = missionDate
        ? await fetchServerAvailabilityMap(ids, missionDate, missionSlot, { heureDebut: missionDebut || null, heureFin: missionFin || null })
        : {}

      const genericServeurMission = isGenericServeurRequested(requestedPostes)

      const hydratedServeurs = ((tableData ?? []) as any[])
        .map((src): (Serveur & { _matchesPoste: boolean; _isMatch: boolean; _withinDistance: boolean }) | null => {
          const ranked = rankedMap[src.id] ?? {}
          const id = String(src.id ?? ranked.id ?? ranked.serveur_id ?? '').trim()
          if (!id) return null

          const serveur: Serveur = {
            id,
            prenom: src.prenom ?? ranked.prenom ?? '',
            nom: src.nom ?? ranked.nom ?? '',
            ville: src.ville ?? ranked.ville ?? '',
            disponible: src.disponible ?? src.is_available ?? ranked.disponible ?? false,
            score: parseNum(src.score ?? ranked.score),
            note: parseNum(src.note ?? src.average_rating ?? ranked.note),
            rating: parseNum(src.rating ?? src.average_rating ?? src.note ?? ranked.rating ?? ranked.note),
            taux_presence: null,
            missions_realisees: parseNum(src.missions_realisees ?? ranked.missions_realisees) ?? 0,
            missions_annulees: parseNum(src.missions_annulees ?? ranked.missions_annulees) ?? 0,
            photo_url: src.photo_url ?? ranked.photo_url ?? null,
            lat: src.lat ?? ranked.lat ?? null,
            lng: src.lng ?? ranked.lng ?? null,
          }
          if (!isWorkerEligibleForMatching(serveur)) return null

          const missionStats = statsMap[id]
          const realisees = missionStats?.completedMissions ?? (serveur.missions_realisees ?? 0)
          const annulees = missionStats?.noShowMissions ?? (serveur.missions_annulees ?? 0)
          const distanceKm =
            hasOriginCoords && hasValidCoordinates(serveur.lat, serveur.lng)
              ? haversineKm(searchLat as number, searchLng as number, serveur.lat as number, serveur.lng as number)
              : null
          const experiencePostes = experiencePostesMap[id] ?? []
          const legacyPostes = normalizeAnnoncePostes(src.postes ?? ranked.postes ?? '')
          const serverPostes = experiencePostes.length > 0 ? experiencePostes : legacyPostes
          const matchesRequestedPoste =
            requestedPostes.length === 0
              ? true
              : serverPostes.length > 0
                ? missionMatchesRequestedPostes(serverPostes, requestedPostes)
                : genericServeurMission

          return {
            ...serveur,
            experience_postes: [...new Set(experiencePostes.filter(Boolean))],
            missions_realisees: realisees,
            missions_annulees: annulees,
            taux_presence: getPresenceRate(realisees, annulees),
            distance_km: distanceKm,
            score_global: computeServeurGlobalScore({
              tauxPresence: getPresenceRate(realisees, annulees),
              noteMoyenne: getRating(serveur),
              distanceKm,
              missionsRealisees: realisees,
            }),
            recommendation_score: computeRecommendationScore({
              tauxPresence: getPresenceRate(realisees, annulees),
              noteMoyenne: getRating(serveur),
              distanceKm,
              missionsRealisees: realisees,
            }),
            _matchesPoste: matchesRequestedPoste,
            _isMatch: missionDate ? availabilityMap[id] !== false : true,
            _withinDistance: hasOriginCoords && distanceKm != null ? distanceKm < MAX_DISTANCE_KM : false,
          }
        })
        .filter(Boolean)

      const baseServeurs = hydratedServeurs
      const posteMatchedServeurs = baseServeurs.filter((serveur: any) => serveur._matchesPoste)
      const availableServeurs = baseServeurs.filter((serveur: any) => serveur._isMatch)
      const distanceFilteredServeurs = availableServeurs.filter((serveur: any) => serveur._withinDistance)
      const nextServeurs = [...distanceFilteredServeurs].sort((a: any, b: any) => compareServeursForDisplay(a, b))

      console.log('serveurs-disponibles: filter-stages', {
        origin: {
          lat: searchLat,
          lng: searchLng,
          ville: searchVille,
          source: searchOrigin,
        },
        totalHydrated: hydratedServeurs.length,
        afterBase: baseServeurs.length,
        afterAvailability: availableServeurs.length,
        afterDistance50Km: distanceFilteredServeurs.length,
        rolePriorityCount: posteMatchedServeurs.length,
        totalFinal: nextServeurs.length,
        profiles: distanceFilteredServeurs.map((serveur: any) => ({
          id: serveur.id,
          nom: `${serveur.prenom ?? ''} ${serveur.nom ?? ''}`.trim(),
          distanceKm: serveur.distance_km,
          available: serveur._isMatch,
          roleMatch: serveur._matchesPoste,
          withinDistance: serveur._withinDistance,
        })),
        exclusions: hydratedServeurs.map((serveur: any) => {
          const reasons: string[] = []
          if (!serveur._isMatch) reasons.push('availability')
          if (!serveur._withinDistance) reasons.push('distance')
          return {
            id: serveur.id,
            nom: `${serveur.prenom ?? ''} ${serveur.nom ?? ''}`.trim(),
            distanceKm: serveur.distance_km,
            requestedPostes,
            roleSource: (experiencePostesMap[serveur.id] ?? []).length > 0 ? 'serveur_experiences' : 'generic_serveur_fallback',
            availabilityResult: serveur._isMatch,
            excludedBy: reasons,
          }
        }),
      })

      console.log(
        'serveurs-disponibles: final-order',
        (nextServeurs as Serveur[]).map((serveur, index) => ({
          order: index + 1,
          id: serveur.id,
          roleMatch: (serveur as any)._matchesPoste ?? false,
          distanceKm: serveur.distance_km ?? null,
          note: getRating(serveur),
          presence: serveur.taux_presence ?? null,
          missionsRealisees: serveur.missions_realisees ?? 0,
          available: true,
        }))
      )

      setCompatibles(nextServeurs as Serveur[])
      setRecommendedId((nextServeurs as Serveur[])[0]?.id ?? null)
      setSelection((prev) => {
        if (prev.size === 0) return prev
        const allowedIds = new Set((nextServeurs as Serveur[]).map((serveur) => serveur.id))
        const next = new Set(Array.from(prev).filter((id) => allowedIds.has(id)))
        if (next.size !== prev.size) {
          console.log('serveurs-disponibles: selection-pruned-by-visibility', {
            before: prev.size,
            after: next.size,
          })
        }
        return next
      })
    } catch (error) {
      console.error('ServeursDisponibles fetchData error:', error)
    }
  }, [
    annonceIdParam,
    isPreviewMission,
    previewDateParam,
    previewHeureDebutParam,
    previewHeureFinParam,
    previewLatParam,
    previewLngParam,
    previewMissionSlotParam,
    previewPosteParam,
    previewPostesParam,
    previewVilleParam,
    router,
    searchOrigin,
  ])

  useEffect(() => {
    fetchData().finally(() => setLoading(false))
  }, [fetchData])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return compatibles
    return compatibles.filter((serveur) =>
      serveur.prenom.toLowerCase().includes(q) ||
      serveur.nom.toLowerCase().includes(q) ||
      serveur.ville.toLowerCase().includes(q)
    )
  }, [search, compatibles])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }, [fetchData])

  const toggleSelection = (id: string) => {
    if (sentIds.has(id) || sending) return
    setSelection((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const envoyerDemandes = async (targetAnnonceId?: string) => {
    const annonceIdToUse =
      typeof targetAnnonceId === 'string' && targetAnnonceId.trim()
        ? targetAnnonceId
        : (annonceIdParam && typeof annonceIdParam === 'string' ? annonceIdParam : null)

    if (!annonceIdToUse) {
      Alert.alert('Erreur', 'Annonce introuvable')
      return
    }
    if (selection.size === 0 || sending) return

    setSending(true)
    try {
      let envoyes = 0
      let doublons = 0
      let echecs = 0
      const newSent = new Set<string>()
      const errorMessages: string[] = []

      for (const serveurId of Array.from(selection)) {
        const { data: existing, error: existingError } = await supabase
          .from('demandes')
          .select('id')
          .eq('annonce_id', annonceIdToUse)
          .eq('serveur_id', serveurId)
          .maybeSingle()

        if (existingError) {
          echecs++
          errorMessages.push(existingError.message)
          continue
        }
        if (existing) {
          doublons++
          newSent.add(serveurId)
          continue
        }

        const stillAvailable = missionInfo?.date
          ? await isServerAvailable(serveurId, missionInfo.date, missionInfo.slot, {
              heureDebut: missionInfo.heure_debut || null,
              heureFin: missionInfo.heure_fin || null,
            })
          : true
        if (!stillAvailable) {
          echecs++
          errorMessages.push(getServerBusySlotMessage(missionInfo?.slot ?? null, 'profile'))
          continue
        }

        const payload: Record<string, string | null> = {
          annonce_id: annonceIdToUse,
          serveur_id: serveurId,
          statut: 'en_attente',
          initiateur: 'patron',
        }
        if (typeof replaceEngagementIdParam === 'string' && replaceEngagementIdParam.trim()) {
          payload.replacement_for_engagement_id = replaceEngagementIdParam
        }

        const { data: insertedDemande, error } = await supabase
          .from('demandes')
          .insert(payload)
          .select('id')
          .maybeSingle()

        if (error || !insertedDemande) {
          echecs++
          if (error?.message) errorMessages.push(error.message)
          continue
        }

        envoyes++
        newSent.add(serveurId)
      }

      if (newSent.size > 0) setSentIds((prev) => new Set([...prev, ...newSent]))
      if (envoyes > 0 || doublons > 0) setSelection(new Set())

      if (envoyes > 0 || doublons > 0) {
        const message = doublons > 0
          ? `${envoyes} envoyée${envoyes > 1 ? 's' : ''}.\n${doublons} déjà existante${doublons > 1 ? 's' : ''}.${echecs > 0 ? `\n${echecs} échec${echecs > 1 ? 's' : ''}.` : ''}`
          : `${envoyes} demande${envoyes > 1 ? 's' : ''} envoyée${envoyes > 1 ? 's' : ''} avec succès.${echecs > 0 ? `\n${echecs} échec${echecs > 1 ? 's' : ''}.` : ''}`
        Alert.alert(FR.requestsSentTitle, message, [{ text: 'OK', onPress: () => router.replace('/dashboard_patron') }])
        return
      }

      Alert.alert('Erreur', getFriendlyDemandesError(errorMessages[0] ?? null))
    } catch (error) {
      console.error('serveurs-disponibles: envoyerDemandes error', error)
      Alert.alert('Erreur', "Impossible d'envoyer les demandes")
    } finally {
      setSending(false)
    }
  }

  const publierAnnonce = async () => {
    setSending(true)
    try {
      if (isPreviewMission) {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.replace('/')
          return
        }

        const previewSlot =
          previewMissionSlotParam === 'midday' || previewMissionSlotParam === 'evening' || previewMissionSlotParam === 'full'
            ? previewMissionSlotParam
            : 'evening'

        const { data: insertedAnnonce, error } = await supabase
          .from('annonces')
          .insert([{
            poste: previewPosteParam ?? '',
            date: previewDateParam ?? '',
            heure_debut: previewHeureDebutParam ?? '',
            heure_fin: previewHeureFinParam ?? '',
            heure_debut_midi: previewHeureDebutMidiParam || null,
            heure_fin_midi: previewHeureFinMidiParam || null,
            heure_debut_soir: previewHeureDebutSoirParam || null,
            heure_fin_soir: previewHeureFinSoirParam || null,
            mission_slot: previewSlot,
            salaire: Number(previewSalaireParam ?? 0),
            description: previewDescriptionParam ?? '',
            statut: 'open',
            ville: previewVilleParam ?? '',
            patron_id: user.id,
            etablissement_id: previewEtablissementIdParam ?? null,
            lat: parseNum(previewLatParam),
            lng: parseNum(previewLngParam),
          }])
          .select('id')
          .single()

        if (error) {
          Alert.alert('Erreur', "Impossible de publier l'annonce pour le moment.")
          return
        }

        if (selection.size > 0 && insertedAnnonce?.id) {
          await envoyerDemandes(String(insertedAnnonce.id))
          return
        }

        Alert.alert(FR.publishedTitle, FR.publishedBody, [
          { text: 'OK', onPress: () => router.replace('/dashboard_patron') },
        ])
        return
      }

      if (!annonceIdParam || typeof annonceIdParam !== 'string') {
        Alert.alert('Erreur', 'Annonce introuvable')
        return
      }

      const { error } = await supabase
        .from('annonces')
        .update({ statut: 'open' })
        .eq('id', annonceIdParam)
        .eq('statut', 'draft')

      if (error) {
        Alert.alert('Erreur', "Impossible de publier l'annonce pour le moment.")
        return
      }

      setAnnonceStatus('open')
      if (selection.size > 0) {
        await envoyerDemandes(annonceIdParam)
        return
      }

      Alert.alert(FR.publishedTitle, FR.publishedBody)
      await fetchData()
    } catch (error) {
      console.error('serveurs-disponibles: publierAnnonce error', error)
      Alert.alert('Erreur', "Impossible de publier l'annonce pour le moment.")
    } finally {
      setSending(false)
    }
  }

  const ouvrirProfilServeur = (serveur: Serveur) => {
    router.push({
      pathname: '/profil-serveur-public',
      params: {
        serveurId: serveur.id,
        annonceId: typeof annonceIdParam === 'string' ? annonceIdParam : '',
        replaceEngagementId: typeof replaceEngagementIdParam === 'string' ? replaceEngagementIdParam : '',
        selectionMode: 'shortlist',
        selectedIds: Array.from(selection).join('|'),
        preview: isPreviewMission ? '1' : '',
        poste: typeof previewPosteParam === 'string' ? previewPosteParam : '',
        postes: typeof previewPostesParam === 'string' ? previewPostesParam : '',
        date: typeof previewDateParam === 'string' ? previewDateParam : '',
        heureDebut: typeof previewHeureDebutParam === 'string' ? previewHeureDebutParam : '',
        heureFin: typeof previewHeureFinParam === 'string' ? previewHeureFinParam : '',
        heureDebutMidi: typeof previewHeureDebutMidiParam === 'string' ? previewHeureDebutMidiParam : '',
        heureFinMidi: typeof previewHeureFinMidiParam === 'string' ? previewHeureFinMidiParam : '',
        heureDebutSoir: typeof previewHeureDebutSoirParam === 'string' ? previewHeureDebutSoirParam : '',
        heureFinSoir: typeof previewHeureFinSoirParam === 'string' ? previewHeureFinSoirParam : '',
        missionSlot: typeof previewMissionSlotParam === 'string' ? previewMissionSlotParam : '',
        salaire: typeof previewSalaireParam === 'string' ? previewSalaireParam : '',
        description: typeof previewDescriptionParam === 'string' ? previewDescriptionParam : '',
        ville: typeof previewVilleParam === 'string' ? previewVilleParam : '',
        etablissementId: typeof previewEtablissementIdParam === 'string' ? previewEtablissementIdParam : '',
        lat: typeof previewLatParam === 'string' ? previewLatParam : '',
        lng: typeof previewLngParam === 'string' ? previewLngParam : '',
      },
    })
  }

  if (loading) {
    return <View style={s.loadWrap}><ActivityIndicator size="large" color={C.green} /></View>
  }

  const nb = selection.size
  const isDraftAnnonce = annonceStatus === 'draft' || isPreviewMission
  const chanceLabel = nb >= 3
    ? FR.chanceHigh
    : nb === 2
      ? FR.chanceMedium
      : nb === 1
        ? FR.chanceOk
        : null
  const requestedPosteLabel =
    missionInfo?.postes && missionInfo.postes.length > 0
      ? missionInfo.postes.length === 1
        ? missionInfo.postes[0]
        : `${missionInfo.postes[0]} +${missionInfo.postes.length - 1}`
      : null

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, (nb > 0 || isDraftAnnonce) && s.contentWithBar]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.green} />}
      >
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Text style={s.backTxt}>{FR.back}</Text>
        </TouchableOpacity>

        <View style={s.header}>
          <View style={s.headerMain}>
            <Text style={s.title}>{FR.title}</Text>
            <Text style={s.headerSub}>{FR.eyebrow}</Text>
          </View>
          <View style={s.countBadge}>
            <Text style={s.countNum}>{filtered.length}</Text>
            <Text style={s.countLabel}>{FR.compatibles}</Text>
          </View>
        </View>

        {missionInfo && (
          <View style={s.missionBanner}>
            <Text style={s.missionBannerLabel}>{FR.mission}</Text>
            <Text style={s.missionBannerTxt}>
              {formatDateFr(missionInfo.date)} · {slotLabel(missionInfo.slot)} · {missionInfo.heure_debut} à {missionInfo.heure_fin}
            </Text>
            <View style={s.missionMetaRow}>
              {requestedPosteLabel ? <Text style={s.missionMetaTxt}>{FR.requestedRole} · {requestedPosteLabel}</Text> : null}
              {patronVille ? (
                <Text style={s.missionMetaTxt}>
                  {FR.aroundCity} {patronVille}{searchOrigin === 'etablissement' ? ` · ${FR.missionOrigin}` : ''}
                </Text>
              ) : null}
            </View>
          </View>
        )}

        <View style={s.instrWrap}>
          <Text style={s.instrTxt}>{FR.intro}</Text>
        </View>

        <View style={[s.selectionSummary, nb > 0 && s.selectionSummaryActive]}>
          <View style={s.selectionSummaryHead}>
            <Text style={s.selectionSummaryLabel}>{FR.shortlist}</Text>
            <Text style={s.selectionSummaryTitle}>
              {nb === 0 ? FR.shortlistEmpty : `${nb} ${nb > 1 ? FR.shortlistProgressPlural : FR.shortlistProgress}`}
            </Text>
          </View>
          <Text style={s.selectionSummaryHint}>{nb === 0 ? FR.shortlistHint : FR.shortlistActiveHint}</Text>
        </View>

        <View style={s.searchWrap}>
          <Text style={s.searchIcon}>⌕</Text>
          <TextInput
            style={s.searchInput}
            placeholder={FR.searchPlaceholder}
            placeholderTextColor={C.muted}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />
          {search.length > 0 ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Text style={s.searchClear}>X</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {filtered.length > 0 ? (
          <View style={s.list}>
            {filtered.map((serveur, index) => {
              const selected = selection.has(serveur.id)
              const sent = sentIds.has(serveur.id)
              const dist = serveur.distance_km != null ? Math.round(serveur.distance_km) : null
              const missions = Math.max(0, parseNum(serveur.missions_realisees) ?? 0)
              const note = getRating(serveur)
              const badgeLabel = getServeurExperienceBadgeLabel(missions)
              const experiencePostes = Array.isArray((serveur as Serveur).experience_postes) ? (serveur as Serveur).experience_postes ?? [] : []
              const experienceLine = `${badgeLabel} · ${missions} mission${missions > 1 ? 's' : ''} réalisée${missions > 1 ? 's' : ''}`
              const availLabel = missionInfo
                ? `${FR.availableOn} ${formatDateFr(missionInfo.date)} · ${slotLabel(missionInfo.slot)}`
                : FR.availableNow

              return (
                <View
                  key={serveur.id}
                  style={[s.card, index < filtered.length - 1 && s.cardMargin, selected && s.cardSelected, sent && s.cardSent, serveur.id === recommendedId && s.cardTop]}
                >
                  {serveur.photo_url ? (
                    <View style={[s.avatarImageWrap, (selected || sent) && s.avatarSelected]}>
                      <Image source={{ uri: serveur.photo_url }} style={s.avatarImage} />
                      <View style={s.avatarDot} />
                    </View>
                  ) : (
                    <View style={[s.avatar, (selected || sent) && s.avatarSelected]}>
                      <Text style={s.avatarTxt}>{initiales(serveur.prenom, serveur.nom)}</Text>
                      <View style={s.avatarDot} />
                    </View>
                  )}

                  <View style={s.cardBody}>
                    <View style={s.cardHeader}>
                      <View style={s.cardTitleWrap}>
                        <Text style={s.cardName}>{`${serveur.prenom} ${serveur.nom}`.trim()}</Text>
                        {missions === 0 && !selected && !sent ? (
                          <View style={s.newBadge}>
                            <Text style={s.newBadgeTxt}>{FR.newBadge}</Text>
                          </View>
                        ) : null}
                        {selected || sent ? (
                          <View style={s.selectedBadge}>
                            <Text style={s.selectedBadgeTxt}>{FR.selected}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>

                    <Text style={s.cardRole}>
                      {requestedPosteLabel ? `${requestedPosteLabel} · ${badgeLabel}` : badgeLabel}
                    </Text>
                    {experiencePostes.length > 0 ? (
                      <View style={s.roleBadgesRow}>
                        {experiencePostes.map((poste) => (
                          <View key={`${serveur.id}-${poste}`} style={s.roleBadge}>
                            <Text style={s.roleBadgeTxt}>{poste}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    <View style={s.availabilityPill}>
                      <Text style={s.availabilityPillTxt}>{availLabel}</Text>
                    </View>
                    <Text style={s.cardExperience}>{experienceLine}</Text>
                    <Text style={s.cardVille}>{serveur.ville || FR.noCity}{dist !== null ? ` · ${dist} km` : ''}</Text>

                    <View style={s.statsRow}>
                      <Text style={s.statChip}>{`${getPresenceRate(missions, parseNum(serveur.missions_annulees) ?? 0) ?? 0}% ${FR.presence}`}</Text>
                      <Text style={s.statChip}>{note != null ? `${note.toFixed(1)} / 5` : FR.notRated}</Text>
                    </View>

                    <View style={s.cardActions}>
                      <TouchableOpacity style={s.secondaryBtn} onPress={() => ouvrirProfilServeur(serveur)} activeOpacity={0.88}>
                        <Text style={s.secondaryBtnTxt}>{FR.profile}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.selectBtn, (selected || sent) && s.selectBtnSel]}
                        onPress={() => toggleSelection(serveur.id)}
                        activeOpacity={0.88}
                        disabled={sent || sending}
                      >
                        <Text style={[s.selectBtnTxt, (selected || sent) && s.selectBtnTxtSel]}>
                          {sent ? FR.selected : selected ? FR.removeSelection : FR.addSelection}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )
            })}
          </View>
        ) : (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>{EMPTY_FR.title}</Text>
            <Text style={s.emptySub}>{FR.noResultHint}</Text>
            <View style={s.emptyActions}>
              <TouchableOpacity style={s.emptySecondaryBtn} onPress={() => router.back()} activeOpacity={0.86}>
                <Text style={s.emptySecondaryBtnTxt}>{EMPTY_FR.adjustMission}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {isDraftAnnonce ? (
        <View style={s.draftBar}>
          <Text style={s.draftBarHint}>{nb > 0 ? FR.readyLabel : FR.footerHintEmpty}</Text>
          <TouchableOpacity style={[s.sendBarBtn, sending && s.sendBarBtnDisabled]} onPress={publierAnnonce} disabled={sending} activeOpacity={0.86}>
            <Text style={s.sendBarBtnTxt}>{sending ? FR.loadingPublish : nb > 0 ? `Publier et contacter ${nb} profil${nb > 1 ? 's' : ''}` : FR.publish}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryDraftBtn} onPress={() => router.back()} activeOpacity={0.86}>
            <Text style={s.secondaryDraftBtnTxt}>{FR.backWithoutPublishing}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Animated.View style={[s.sendBar, { transform: [{ translateY: barAnim.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) }], opacity: barAnim }]}>
          <Text style={s.sendBarHint}>{chanceLabel ?? FR.footerHint}</Text>
          <TouchableOpacity style={[s.sendBarBtn, sending && s.sendBarBtnDisabled]} onPress={() => envoyerDemandes()} disabled={sending || nb === 0} activeOpacity={0.86}>
            <Text style={s.sendBarBtnTxt}>{nb === 0 ? FR.selectAtLeastOne : nb === 1 ? FR.contactOne : `${FR.contactMany} ${nb} profils`}</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  loadWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { paddingBottom: 44 },
  contentWithBar: { paddingBottom: 148 },
  backBtn: { paddingTop: 54, paddingHorizontal: 22, marginBottom: 4, alignSelf: 'flex-start' },
  backTxt: { fontSize: 15, color: C.textSub, fontWeight: '700' },
  header: { paddingTop: 6, paddingHorizontal: 22, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  headerMain: { flex: 1 },
  eyebrow: { fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', color: C.muted, marginBottom: 6, fontWeight: '700' },
  title: { fontSize: 30, fontWeight: '800', color: C.text, letterSpacing: -0.8, lineHeight: 34 },
  headerSub: { fontSize: 13, color: C.textSub, marginTop: 4, fontWeight: '600' },
  countBadge: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', minWidth: 84, shadowColor: '#000000', shadowOpacity: 0.02, shadowOffset: { width: 0, height: 8 }, shadowRadius: 16, elevation: 1 },
  countNum: { fontSize: 24, fontWeight: '800', color: C.green, letterSpacing: -1 },
  countLabel: { fontSize: 11, color: C.muted, marginTop: 2, fontWeight: '700' },
  missionBanner: { marginHorizontal: 16, marginBottom: 10, backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, paddingHorizontal: 16, paddingVertical: 14, shadowColor: '#000000', shadowOpacity: 0.015, shadowOffset: { width: 0, height: 8 }, shadowRadius: 14, elevation: 1 },
  missionBannerLabel: { fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', color: C.muted, marginBottom: 6, fontWeight: '700' },
  missionBannerTxt: { fontSize: 14, color: C.text, lineHeight: 20, fontWeight: '800' },
  missionMetaRow: { marginTop: 8, gap: 4 },
  missionMetaTxt: { fontSize: 12, color: C.textSub, fontWeight: '600' },
  instrWrap: { marginHorizontal: 16, marginBottom: 10, backgroundColor: '#F0F6F2', borderRadius: 14, borderWidth: 1, borderColor: '#DDEADF', paddingHorizontal: 14, paddingVertical: 11 },
  instrTxt: { fontSize: 12, color: C.textSub, lineHeight: 18 },
  selectionSummary: { marginHorizontal: 16, marginBottom: 12, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
  selectionSummaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  selectionSummaryActive: { backgroundColor: C.greenBg, borderColor: C.greenBd },
  selectionSummaryLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: C.muted, marginBottom: 4 },
  selectionSummaryTitle: { fontSize: 15, fontWeight: '800', color: C.text },
  selectionSummaryHint: { fontSize: 12, lineHeight: 16, color: C.textSub },
  searchWrap: { marginHorizontal: 16, marginBottom: 16, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, shadowColor: '#000000', shadowOpacity: 0.015, shadowOffset: { width: 0, height: 8 }, shadowRadius: 14, elevation: 1 },
  searchIcon: { fontSize: 15, marginRight: 8, color: C.textSub },
  searchInput: { flex: 1, height: 48, fontSize: 14, color: C.text },
  searchClear: { fontSize: 14, color: C.muted, paddingLeft: 8 },
  locationHintWrap: { paddingHorizontal: 16, marginBottom: 18 },
  locationHintTxt: { fontSize: 12, color: C.muted },
  list: { paddingHorizontal: 16 },
  card: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 16, flexDirection: 'row', alignItems: 'flex-start', shadowColor: '#000000', shadowOpacity: 0.02, shadowOffset: { width: 0, height: 8 }, shadowRadius: 16, elevation: 1 },
  cardMargin: { marginBottom: 12 },
  cardSelected: { borderColor: C.green, backgroundColor: '#F8FCF9' },
  cardSent: { borderColor: C.greenBd, backgroundColor: '#F6FBF8' },
  cardTop: { borderColor: '#D6E8DB' },
  avatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#F0E9DF', borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginRight: 14, flexShrink: 0 },
  avatarImageWrap: { width: 58, height: 58, borderRadius: 29, marginRight: 14, flexShrink: 0, position: 'relative', overflow: 'hidden', borderWidth: 1, borderColor: C.border, backgroundColor: '#F0E9DF' },
  avatarImage: { width: '100%', height: '100%' },
  avatarSelected: { borderColor: C.greenBd },
  avatarTxt: { fontSize: 17, fontWeight: '800', color: '#2D241D' },
  avatarDot: { position: 'absolute', bottom: 2, right: 2, width: 11, height: 11, borderRadius: 6, backgroundColor: C.green, borderWidth: 2, borderColor: C.card },
  cardBody: { flex: 1 },
  cardHeader: { marginBottom: 4 },
  cardTitleWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  cardName: { fontSize: 20, fontWeight: '800', color: C.text, marginRight: 2, letterSpacing: -0.3 },
  newBadge: { backgroundColor: '#F4F4F4', borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  newBadgeTxt: { fontSize: 11, fontWeight: '700', color: C.textSub },
  selectedBadge: { backgroundColor: C.greenBg, borderWidth: 1, borderColor: C.greenBd, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  selectedBadgeTxt: { fontSize: 11, fontWeight: '800', color: C.green },
  cardRole: { display: 'none', fontSize: 13, color: C.textSub, fontWeight: '700', marginBottom: 0 },
  roleBadgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  roleBadge: {
    backgroundColor: '#F5F1EA',
    borderWidth: 1,
    borderColor: '#E7DED1',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  roleBadgeTxt: { fontSize: 11, color: '#3E342D', fontWeight: '700' },
  cardExperience: { fontSize: 13, color: C.text, fontWeight: '700', marginBottom: 6 },
  availabilityPill: { alignSelf: 'flex-start', backgroundColor: C.greenBg, borderWidth: 1, borderColor: C.greenBd, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10 },
  availabilityPillTxt: { fontSize: 12, color: C.green, fontWeight: '800' },
  cardVille: { fontSize: 12, color: C.textSub, fontWeight: '600', marginBottom: 10 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  statChip: { fontSize: 11, color: C.textSub, fontWeight: '700', backgroundColor: C.soft, borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectBtn: { flex: 1, backgroundColor: C.green, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  selectBtnSel: { backgroundColor: C.greenBg, borderWidth: 1, borderColor: C.greenBd },
  selectBtnTxt: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  selectBtnTxtSel: { color: C.green },
  secondaryBtn: { minWidth: 118, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F6F2' },
  secondaryBtnTxt: { fontSize: 12, fontWeight: '800', color: C.text },
  emptyCard: { marginHorizontal: 16, backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 28, alignItems: 'center', shadowColor: '#000000', shadowOpacity: 0.015, shadowOffset: { width: 0, height: 8 }, shadowRadius: 16, elevation: 1 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: C.text, textAlign: 'center', marginBottom: 10 },
  emptySub: { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 21 },
  emptyActions: { width: '100%', marginTop: 18, gap: 10 },
  emptyPrimaryBtn: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  emptyPrimaryBtnTxt: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  emptySecondaryBtn: { borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2EEE7' },
  emptySecondaryBtnTxt: { fontSize: 14, fontWeight: '700', color: C.textSub },
  sendBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(246,243,238,0.98)', borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 30 },
  sendBarHint: { fontSize: 12, color: C.textSub, fontWeight: '600', textAlign: 'center', marginBottom: 10 },
  sendBarBtn: { backgroundColor: C.green, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.02, shadowOffset: { width: 0, height: 8 }, shadowRadius: 14, elevation: 1 },
  sendBarBtnDisabled: { opacity: 0.6 },
  sendBarBtnTxt: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  draftBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(246,243,238,0.98)', borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 30 },
  draftBarHint: { fontSize: 12, color: C.textSub, fontWeight: '600', textAlign: 'center', marginBottom: 10 },
  secondaryDraftBtn: { marginTop: 10, borderRadius: 16, borderWidth: 1, borderColor: C.border, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFECE6' },
  secondaryDraftBtnTxt: { fontSize: 14, fontWeight: '700', color: C.textSub },
})


