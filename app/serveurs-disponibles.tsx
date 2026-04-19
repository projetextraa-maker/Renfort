import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useEffect, useRef, useState } from 'react'
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
import { EURO } from '../lib/currency'
import { fetchEtablissementById } from '../lib/etablissements'
import { DISTANCE_FILTERS_KM, haversineKm, isWithinDistanceRadius } from '../lib/location-distance'
import { isWorkerEligibleForMatching } from '../lib/mission-hiring'
import { envoyerNotificationLocale } from '../lib/notifications'
import { getPresenceRate } from '../lib/serveur-presence'
import { fetchServerAvailabilityMap, getServerBusySlotMessage, isServerAvailable } from '../lib/server-availability'
import { type MissionSlot } from '../lib/serveur-disponibilites'
import { compareServeurRanking, computeRecommendationScore, computeServeurGlobalScore } from '../lib/serveur-score'
import { computeServeurMissionStatsMap } from '../lib/serveur-stats'
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
  avg_response_seconds?: number | null
  missions_realisees: number | null
  missions_acceptees: number | null
  missions_annulees: number | null
  rayon: number
  badge: string | null
  photo_url: string | null
  description?: string | null
  lat: number | null
  lng: number | null
  distance_km?: number | null
  score_global?: number | null
  recommendation_score?: number | null
}

function parseNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function getRating(s: Serveur): number | null {
  return parseNum(s.score ?? s.note ?? s.rating)
}
function initiales(prenom: string, nom: string): string {
  return `${prenom?.[0] ?? ''}${nom?.[0] ?? ''}`.toUpperCase()
}
function formatDateFr(dateStr: string): string {
  if (!dateStr) return ''
  const p = dateStr.split('-')
  if (p.length !== 3) return dateStr
  try {
    const d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])))
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  } catch { return dateStr }
}
function slotLabel(slot: MissionSlot): string {
  if (slot === 'midday')  return 'Midi'
  if (slot === 'evening') return 'Soir'
  return 'Journee (Midi + Soir)'
}
function getFriendlyDemandesError(errorMessage: string | null | undefined): string {
  const lower = String(errorMessage ?? '').toLowerCase()
  if (lower.includes('replacement_for_engagement_id') && lower.includes('could not find')) {
    return "Le mode remplacement n'est pas encore configure dans la base. Executez la migration engagements, puis reessayez."
  }
  if (lower.includes('row-level security') || lower.includes('permission denied')) {
    return "L'envoi de la demande est refuse par les regles d'acces de la base."
  }
  return "Impossible d'envoyer les demandes pour le moment."
}

const C = {
  bg:      '#141414',
  card:    '#232323',
  border:  '#2F2F2F',
  green:   '#34D378',
  greenBg: 'rgba(52,211,120,0.10)',
  greenBd: 'rgba(52,211,120,0.20)',
  greenDk: '#0F1A14',
  text:    '#F0EDE6',
  textSub: '#E8E5DD',
  muted:   '#888888',
}

export default function ServeursDisponibles() {
  const router = useRouter()
  const { annonceId, replaceEngagementId } = useLocalSearchParams()
  const annonceIdParam = Array.isArray(annonceId) ? annonceId[0] : annonceId
  const replaceEngagementIdParam = Array.isArray(replaceEngagementId) ? replaceEngagementId[0] : replaceEngagementId

  const [compatibles,   setCompatibles]   = useState<Serveur[]>([])
  const [filtered,      setFiltered]      = useState<Serveur[]>([])
  const [loading,       setLoading]       = useState(true)
  const [refreshing,    setRefreshing]    = useState(false)
  const [search,        setSearch]        = useState('')
  const [patronVille,   setPatronVille]   = useState<string | null>(null)
  const [searchOrigin,  setSearchOrigin]  = useState<'etablissement' | 'patron' | 'legacy_annonce' | null>(null)
  const [rayon,         setRayon]         = useState(20)
  const [selection,     setSelection]     = useState<Set<string>>(new Set())
  const [sentIds,       setSentIds]       = useState<Set<string>>(new Set())
  const [sending,       setSending]       = useState(false)
  const [recommendedId, setRecommendedId] = useState<string | null>(null)
  const [missionInfo,   setMissionInfo]   = useState<{
    date: string; heure_debut: string; heure_fin: string; slot: MissionSlot; postes: string[]
  } | null>(null)
  const [replacementContext, setReplacementContext] = useState<{
    engagementId: string
    serveurId: string | null
    serveurName: string | null
  } | null>(null)
  const [didAutoSelect, setDidAutoSelect] = useState(false)

  const barAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.spring(barAnim, {
      toValue: selection.size > 0 ? 1 : 0,
      useNativeDriver: true, tension: 100, friction: 12,
    }).start()
  }, [barAnim, selection.size])

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }

      const { data: patron } = await supabase
        .from('patrons').select('ville, lat, lng').eq('id', user.id).single()

      let searchLat: number | null = patron?.lat ?? null
      let searchLng: number | null = patron?.lng ?? null
      let searchVille: string | null = patron?.ville ?? null

      if (patron) {
        setPatronVille(patron.ville)
        setSearchOrigin('patron')
      }

      let missionDate  = ''
      let missionDebut = ''
      let missionFin   = ''
      let mSlot: MissionSlot = 'evening'
      let requestedPostes: string[] = []
      let replacedServeurId: string | null = null

      if (annonceIdParam && typeof annonceIdParam === 'string') {
        const { data: a } = await supabase
          .from('annonces')
          .select(ANNONCE_COMPAT_SELECT)
          .eq('id', annonceIdParam)
          .maybeSingle()

        if (a) {
          const annonce = normalizeAnnonceRecord(a as any)
          if (annonce.etablissement_id) {
            const missionEtablissement = await fetchEtablissementById(annonce.etablissement_id)
            if (missionEtablissement) {
              searchLat = missionEtablissement.lat ?? searchLat
              searchLng = missionEtablissement.lng ?? searchLng
              searchVille = missionEtablissement.ville ?? searchVille
              setPatronVille(missionEtablissement.ville ?? patron?.ville ?? null)
              setSearchOrigin('etablissement')
            }
          } else if (annonce.lat != null && annonce.lng != null) {
            searchLat = annonce.lat
            searchLng = annonce.lng
            searchVille = annonce.ville || searchVille
            setPatronVille(annonce.ville || patron?.ville || null)
            setSearchOrigin('legacy_annonce')
          }

          console.info('serveurs-disponibles: search origin resolved', {
            annonceId: annonceIdParam,
            etablissementId: annonce.etablissement_id ?? null,
            source: annonce.etablissement_id
              ? 'etablissement'
              : annonce.lat != null && annonce.lng != null
                ? 'legacy_annonce'
                : 'patron',
            ville: searchVille,
            lat: searchLat,
            lng: searchLng,
          })

          if (annonce.date && annonce.heure_debut && annonce.heure_fin) {
            missionDate  = annonce.date
            missionDebut = annonce.heure_debut
            missionFin   = annonce.heure_fin
            requestedPostes = normalizeAnnoncePostes(annonce.poste)
            if (annonce.mission_slot === 'midday' || annonce.mission_slot === 'evening' || annonce.mission_slot === 'full') {
              mSlot = annonce.mission_slot
            }
            setMissionInfo({ date: missionDate, heure_debut: missionDebut, heure_fin: missionFin, slot: mSlot, postes: requestedPostes })
          }
        }
      }

      if (typeof replaceEngagementIdParam === 'string' && replaceEngagementIdParam.trim()) {
        const { data: replacedEngagement, error: replacedEngagementError } = await supabase
          .from('engagements')
          .select('id, serveur_id')
          .eq('id', replaceEngagementIdParam)
          .maybeSingle()

        if (replacedEngagementError) {
          console.warn('serveurs-disponibles: replacement context unavailable', {
            engagementId: replaceEngagementIdParam,
            error: replacedEngagementError.message,
          })
          setReplacementContext({
            engagementId: replaceEngagementIdParam,
            serveurId: null,
            serveurName: null,
          })
        } else {
          replacedServeurId = replacedEngagement?.serveur_id ? String(replacedEngagement.serveur_id) : null
          setReplacementContext({
            engagementId: replaceEngagementIdParam,
            serveurId: replacedServeurId,
            serveurName: null,
          })
        }
      } else {
        setReplacementContext(null)
      }

      const { data: srvs } = await supabase.rpc('get_ranked_serveurs_simple')
      const rankedMap = Object.fromEntries(
        ((srvs as any[]) ?? []).map(r => [r.id ?? r.serveur_id, r]).filter(([id]) => Boolean(id))
      )

      const { data: tableData } = await supabase.from('serveurs').select('*')

      const allServeurs = (tableData ?? []).map((src: any): Serveur | null => {
        const ranked = rankedMap[src.id] ?? {}
        const serveurId = String(src.id ?? ranked.id ?? ranked.serveur_id ?? '').trim()
        if (!serveurId) {
          console.warn('serveurs-disponibles: serveur sans identifiant exploitable', {
            srcId: src?.id ?? null,
            rankedId: ranked?.id ?? null,
            rankedServeurId: ranked?.serveur_id ?? null,
          })
          return null
        }
        const real   = parseNum(src.missions_realisees ?? ranked.missions_realisees) ?? 0
        const annul  = parseNum(src.missions_annulees  ?? ranked.missions_annulees)  ?? 0
        const accept = parseNum(src.missions_acceptees ?? ranked.missions_acceptees) ?? 0
        const merged: Serveur = {
          ...ranked, ...src,
          id:                   serveurId,
          prenom:               src.prenom  ?? ranked.prenom  ?? '',
          nom:                  src.nom     ?? ranked.nom     ?? '',
          ville:                src.ville   ?? ranked.ville   ?? '',
          disponible:           src.disponible ?? src.is_available ?? ranked.disponible ?? false,
          score:                parseNum(src.score  ?? ranked.score),
          note:                 parseNum(src.note   ?? src.average_rating ?? ranked.note),
          rating:               parseNum(src.rating ?? src.average_rating ?? src.note ?? ranked.rating ?? ranked.note),
          taux_presence:        getPresenceRate(real, annul),
          avg_response_seconds: parseNum(src.avg_response_seconds ?? ranked.avg_response_seconds),
          missions_realisees:   real,
          missions_acceptees:   accept,
          missions_annulees:    annul,
          rayon:     src.rayon     ?? ranked.rayon     ?? 0,
          badge:     src.badge     ?? ranked.badge     ?? null,
          photo_url: src.photo_url ?? ranked.photo_url ?? null,
          lat:       src.lat       ?? ranked.lat       ?? null,
          lng:       src.lng       ?? ranked.lng       ?? null,
        }
        return isWorkerEligibleForMatching(merged) ? merged : null
      }).filter(Boolean) as Serveur[]

      const statsMap = await computeServeurMissionStatsMap(allServeurs.map(s => s.id))
      const experienceMap = new Map<string, string[]>()
      if (allServeurs.length > 0) {
        const { data: experienceRows } = await supabase
          .from('serveur_experiences')
          .select('serveur_id, poste')
          .in('serveur_id', allServeurs.map((s) => s.id))

        ;(experienceRows ?? []).forEach((row: any) => {
          if (!row?.serveur_id) return
          const current = experienceMap.get(row.serveur_id) ?? []
          if (row.poste) current.push(String(row.poste))
          experienceMap.set(row.serveur_id, current)
        })
      }

      const nextAvailabilityMap = missionDate
        ? await fetchServerAvailabilityMap(
            allServeurs.map((server) => server.id),
            missionDate,
            mSlot,
            {
              heureDebut: missionDebut || null,
              heureFin: missionFin || null,
            }
          )
        : {}

      const compatible = allServeurs
        .map(s => {
          const mStats     = statsMap[s.id]
          const realisees  = mStats?.completedMissions ?? (s.missions_realisees ?? 0)
          const annulees   = mStats?.noShowMissions    ?? (s.missions_annulees  ?? 0)
          const distKm     =
            searchLat != null && searchLng != null && s.lat != null && s.lng != null
              ? haversineKm(searchLat, searchLng, s.lat, s.lng)
              : null
          const serverPostes = experienceMap.get(s.id) ?? []
          const isMatch = missionDate
            ? nextAvailabilityMap[String(s.id)] !== false
            : false
          const matchesPoste = missionMatchesRequestedPostes(serverPostes, requestedPostes)
          const tauxP  = getPresenceRate(realisees, annulees)
          const rating = getRating(s)
          return {
            ...s,
            taux_presence:        tauxP,
            missions_realisees:   realisees,
            missions_annulees:    annulees,
            distance_km:          distKm,
            score_global:         computeServeurGlobalScore({ tauxPresence: tauxP, noteMoyenne: rating, distanceKm: distKm, missionsRealisees: realisees }),
            recommendation_score: computeRecommendationScore({ tauxPresence: tauxP, noteMoyenne: rating, distanceKm: distKm, missionsRealisees: realisees }),
            _isMatch:             isMatch,
            _matchesPoste:        matchesPoste,
          }
        })
        .filter(s => s._isMatch)
        .filter(s => !replacedServeurId || s.id !== replacedServeurId)
        .filter(s => isWithinDistanceRadius(s.distance_km, rayon))

      const posteFiltered = requestedPostes.length > 0
        ? compatible.filter((s: any) => s._matchesPoste)
        : compatible

      const pool = posteFiltered.length > 0 ? posteFiltered : compatible

      const ranked = [...pool].sort((a, b) =>
        compareServeurRanking(
          { tauxPresence: a.taux_presence ?? null, missionsRealisees: a.missions_realisees ?? 0, noteMoyenne: getRating(a), distanceKm: a.distance_km ?? null },
          { tauxPresence: b.taux_presence ?? null, missionsRealisees: b.missions_realisees ?? 0, noteMoyenne: getRating(b), distanceKm: b.distance_km ?? null }
        )
      )

      setCompatibles(ranked)
      setFiltered(ranked)
      setRecommendedId(ranked[0]?.id ?? null)
      setReplacementContext((prev) => {
        if (!prev) return prev
        const replacedServer = prev.serveurId
          ? allServeurs.find((server) => server.id === prev.serveurId) ?? null
          : null
        return {
          ...prev,
          serveurName: replacedServer ? `${replacedServer.prenom} ${replacedServer.nom}` : prev.serveurName,
        }
      })
    } catch (e) {
      console.error('ServeursDisponibles fetchData error:', e)
    }
  }, [annonceIdParam, rayon, replaceEngagementIdParam, router])

  useEffect(() => { fetchData().finally(() => setLoading(false)) }, [fetchData])
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false) }, [fetchData])

  useEffect(() => {
    if (!search.trim()) { setFiltered(compatibles); return }
    const q = search.toLowerCase()
    setFiltered(compatibles.filter(s =>
      s.prenom?.toLowerCase().includes(q) || s.nom?.toLowerCase().includes(q) || s.ville?.toLowerCase().includes(q)
    ))
  }, [search, compatibles])

  useEffect(() => {
    if (didAutoSelect || filtered.length === 0 || selection.size > 0 || sending) return
    const firstId = filtered[0]?.id
    if (!firstId || sentIds.has(firstId)) return
    setSelection(new Set([firstId]))
    setDidAutoSelect(true)
  }, [didAutoSelect, filtered, selection.size, sending, sentIds])

  const toggleSelection = (id: string) => {
    if (sentIds.has(id) || sending) return
    setSelection(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        if (id === filtered[0]?.id) Alert.alert('Information', 'Pensez a contacter plusieurs profils pour maximiser vos chances')
      } else { next.add(id) }
      return next
    })
  }

  const envoyerDemandes = async () => {
    if (!annonceIdParam || typeof annonceIdParam !== 'string') { Alert.alert('Erreur', 'Annonce introuvable'); return }
    if (selection.size === 0 || sending) return
    setSending(true)
    try {
      let envoyes = 0, doublons = 0, echecs = 0
      const newSent = new Set<string>()
      const errorMessages: string[] = []
      for (const sid of Array.from(selection)) {
        console.info('serveurs-disponibles: verification demande existante', {
          annonceId: annonceIdParam,
          serveurId: sid,
        })

        const { data: existing, error: existingError } = await supabase
          .from('demandes')
          .select('id')
          .eq('annonce_id', annonceIdParam)
          .eq('serveur_id', sid)
          .maybeSingle()

        if (existingError) {
          console.error('serveurs-disponibles: lookup demande existante error', {
            annonceId: annonceIdParam,
            serveurId: sid,
            error: existingError.message,
          })
          echecs++
          errorMessages.push(existingError.message)
          continue
        }

        if (existing) {
          console.info('serveurs-disponibles: demande deja existante', {
            annonceId: annonceIdParam,
            serveurId: sid,
            demandeId: existing.id ?? null,
          })
          doublons++
          newSent.add(sid)
          continue
        }

        const stillAvailable = missionInfo?.date
          ? await isServerAvailable(sid, missionInfo.date, missionInfo.slot, {
              heureDebut: missionInfo.heure_debut || null,
              heureFin: missionInfo.heure_fin || null,
            })
          : true

        if (!stillAvailable) {
          console.info('serveurs-disponibles: demande ignoree car serveur deja engage sur ce creneau', {
            annonceId: annonceIdParam,
            serveurId: sid,
          })
          echecs++
          errorMessages.push(getServerBusySlotMessage(missionInfo?.slot ?? null, 'profile'))
          continue
        }

        const payload: Record<string, string | null> = {
          annonce_id: annonceIdParam,
          serveur_id: sid,
          statut: 'en_attente',
          initiateur: 'patron',
        }
        if (typeof replaceEngagementIdParam === 'string' && replaceEngagementIdParam.trim()) {
          payload.replacement_for_engagement_id = replaceEngagementIdParam
        }

        console.info('serveurs-disponibles: insert demande payload', payload)

        const { data: insertedDemande, error } = await supabase
          .from('demandes')
          .insert(payload)
          .select('id, annonce_id, serveur_id, statut, initiateur')
          .maybeSingle()

        console.info('serveurs-disponibles: insert demande resultat', {
          annonceId: annonceIdParam,
          serveurId: sid,
          data: insertedDemande ?? null,
          error: error?.message ?? null,
        })

        if (error || !insertedDemande) {
          echecs++
          if (error?.message) errorMessages.push(error.message)
          continue
        }

        envoyes++
        newSent.add(sid)
      }
      if (newSent.size > 0) setSentIds(prev => new Set([...prev, ...newSent]))
      if (envoyes > 0 || doublons > 0) {
        setSelection(new Set())
      }
      if (envoyes > 0) {
        await envoyerNotificationLocale(
          isUrgentReplacementMode ? 'Remplacement urgent lance' : 'Demandes envoyees',
          isUrgentReplacementMode
            ? `${envoyes} profil${envoyes > 1 ? 's' : ''} contacte${envoyes > 1 ? 's' : ''} en urgence.`
            : `${envoyes} profil${envoyes > 1 ? 's' : ''} contacte${envoyes > 1 ? 's' : ''}.`
        )
      }

      if (envoyes > 0 || doublons > 0) {
        const msg = doublons > 0
          ? `${envoyes} envoyee${envoyes > 1 ? 's' : ''}.\n${doublons} deja existante${doublons > 1 ? 's' : ''}.${echecs > 0 ? `\n${echecs} echec${echecs > 1 ? 's' : ''}.` : ''}`
          : `${envoyes} demande${envoyes > 1 ? 's' : ''} envoyee${envoyes > 1 ? 's' : ''} avec succes.${echecs > 0 ? `\n${echecs} echec${echecs > 1 ? 's' : ''}.` : ''}`
        Alert.alert(isUrgentReplacementMode ? 'Urgence envoyee' : 'Interets envoyes', msg, [{ text: 'OK', onPress: () => router.replace('/dashboard_patron') }])
        return
      }

      const errorMessage = getFriendlyDemandesError(errorMessages[0] ?? null)
      Alert.alert('Erreur', errorMessage)
    } catch (e) {
      console.error('serveurs-disponibles: envoyerDemandes unexpected error', e)
      Alert.alert('Erreur', "Impossible d'envoyer les demandes")
    }
    finally { setSending(false) }
  }

  const confirmerEnvoi = async () => {
    if (selection.size === 0 || sending) return
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: patron } = await supabase.from('patrons').select('abonnement').eq('id', user.id).single()
      if (patron?.abonnement === 'pro' || patron?.abonnement === 'pro_plus') { envoyerDemandes(); return }
    }
    Alert.alert('Confirmation', `Si cette mission est realisee, elle vous sera facturee 10${EURO}.\n\nAucun frais en cas de refus.`, [
      { text: 'Confirmer', onPress: envoyerDemandes },
      { text: 'Annuler', style: 'cancel' },
    ])
  }

  const ouvrirProfilServeur = (srv: Serveur) => {
    const serveurId = String(srv.id ?? '').trim()
    const annonceIdForProfile = typeof annonceIdParam === 'string' ? annonceIdParam : ''

    console.info('serveurs-disponibles: ouverture profil serveur', {
      serveurId,
      annonceId: annonceIdForProfile || null,
      prenom: srv.prenom ?? null,
      nom: srv.nom ?? null,
    })

    if (!serveurId) {
      Alert.alert('Erreur', 'Identifiant serveur introuvable.')
      return
    }

    router.push({
      pathname: '/profil-serveur-public',
      params: {
        serveurId,
        annonceId: annonceIdForProfile,
        replaceEngagementId: typeof replaceEngagementIdParam === 'string' ? replaceEngagementIdParam : '',
      },
    })
  }

  const renderCard = (srv: Serveur, index: number, total: number) => {
    const isTop  = srv.id === recommendedId
    const inits  = initiales(srv.prenom, srv.nom)
    const dist   = srv.distance_km != null ? Math.round(srv.distance_km) : null
    const sel    = selection.has(srv.id)
    const sent   = sentIds.has(srv.id)
    const mc     = parseNum(srv.missions_realisees)
    const availLabel = missionInfo
      ? `Disponible le ${formatDateFr(missionInfo.date)} — ${slotLabel(missionInfo.slot)}`
      : 'Disponible pour ce creneau'
    const showNewBadge = (mc ?? 0) <= 0
    const profileBadgeLabel = showNewBadge ? 'Nouveau' : 'Experimente'
    const presenceRate = getPresenceRate(mc ?? 0, parseNum(srv.missions_annulees) ?? 0) ?? 0
    const infoLine = showNewBadge
      ? '0 mission - Nouveau'
      : `${Math.max(0, mc ?? 0)} mission${(mc ?? 0) > 1 ? 's' : ''} - ${presenceRate}% present`

    return (
      <TouchableOpacity
        key={`card-${srv.id}`}
        style={[s.card, index < total - 1 && s.cardMargin, sel && s.cardSelected, sent && s.cardSent, isTop && s.cardTop]}
        activeOpacity={0.97}
        onPress={() => ouvrirProfilServeur(srv)}
      >
        {srv.photo_url ? (
          <View style={[s.avatarImageWrap, (sel || sent) && s.avatarSelected]}>
            <Image source={{ uri: srv.photo_url }} style={s.avatarImage} />
            <View style={s.avatarDot} />
          </View>
        ) : (
          <View style={[s.avatar, (sel || sent) && s.avatarSelected]}>
            <Text style={s.avatarTxt}>{inits}</Text>
            <View style={s.avatarDot} />
          </View>
        )}

        <View style={s.cardBody}>
          <View style={s.cardHeader}>
            <View style={s.nameWrap}>
              <Text style={s.cardName}>{srv.prenom}</Text>
            </View>
          </View>

          <View style={s.metaRow}>
            <Text style={s.cardVille}>{srv.ville || 'Ville non renseignee'}{dist !== null ? ` - ${dist} km` : ''}</Text>
          </View>

          <View style={s.statusRow}>
            <Text style={s.statusText}>{availLabel}</Text>
            <Text style={[s.statusTag, showNewBadge ? s.statusTagNew : s.statusTagExperience]}>
              {profileBadgeLabel}
            </Text>
          </View>

          <Text style={s.infoLineText} numberOfLines={1}>
            {infoLine}
          </Text>

          <View style={s.cardActions}>
            <TouchableOpacity
              style={[s.selectBtn, sel && s.selectBtnSel, sent && s.selectBtnSel]}
              onPress={() => toggleSelection(srv.id)}
              activeOpacity={0.88}
              disabled={sent || sending}
            >
              <Text style={[s.selectBtnTxt, (sel || sent) && s.selectBtnTxtSel]}>
                {sent || sel ? 'Selectionne' : 'Selectionner'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    )
  }

  if (loading) return <View style={s.loadWrap}><ActivityIndicator size="large" color={C.green} /></View>

  const nb = selection.size
  const isUrgentReplacementMode = Boolean(replacementContext?.engagementId)
  const chanceLabel =
    nb >= 3 ? 'Tres forte chance de reponse'
    : nb === 2 ? '2 profils - chance elevee'
    : nb === 1 ? 'Chance de reponse correcte'
    : null

  return (
    <View style={s.screen}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, nb > 0 && s.contentWithBar]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.green} />}
      >
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Text style={s.backTxt}>← Retour</Text>
        </TouchableOpacity>

        <View style={s.header}>
          <View>
            <Text style={s.eyebrow}>{isUrgentReplacementMode ? 'REMPLACEMENT URGENT' : 'PROFILS COMPATIBLES'}</Text>
            <Text style={s.title}>{isUrgentReplacementMode ? `Trouver un${'\n'}remplacant` : `Personnel${'\n'}disponible`}</Text>
          </View>
          <View style={s.countBadge}>
            <Text style={s.countNum}>{filtered.length}</Text>
            <Text style={s.countLabel}>compatible{filtered.length !== 1 ? 's' : ''}</Text>
          </View>
        </View>

        {missionInfo && (
          <View style={s.missionBanner}>
            <Text style={s.missionBannerTxt}>
              {formatDateFr(missionInfo.date)} · {slotLabel(missionInfo.slot)} · {missionInfo.heure_debut} a {missionInfo.heure_fin}
            </Text>
            {isUrgentReplacementMode ? (
              <Text style={s.missionBannerSubTxt}>
                {replacementContext?.serveurName
                  ? `Urgence active : ${replacementContext.serveurName} est exclu de cette shortlist.`
                  : 'Urgence active : le serveur initial est exclu de cette shortlist.'}
              </Text>
            ) : null}
          </View>
        )}

        <View style={s.instrWrap}>
          <Text style={s.instrTxt}>
            {isUrgentReplacementMode
              ? "Shortlist urgence : memes date, creneau et etablissement, avec distance, activite et disponibilite revalidees."
              : 'Ces profils ont ce creneau dans leur calendrier, gardent leur profil actif et sont tries par fiabilite, note et distance.'}
          </Text>
        </View>

        <View style={s.searchWrap}>
          <Text style={s.searchIcon}>🔍</Text>
          <TextInput style={s.searchInput} placeholder="Nom, ville..." placeholderTextColor={C.muted} value={search} onChangeText={setSearch} autoCapitalize="none" />
          {search.length > 0 && <TouchableOpacity onPress={() => setSearch('')}><Text style={s.searchClear}>X</Text></TouchableOpacity>}
        </View>

        <View style={s.rayonRow}>
          {DISTANCE_FILTERS_KM.map(r => (
            <TouchableOpacity key={r} style={[s.rayonBtn, rayon === r && s.rayonBtnActive]} onPress={() => setRayon(r)} activeOpacity={0.7}>
              <Text style={[s.rayonTxt, rayon === r && s.rayonTxtActive]}>{r} km</Text>
            </TouchableOpacity>
          ))}
          {patronVille && (
            <Text style={s.rayonVille}>
              autour de {patronVille}{searchOrigin === 'etablissement' ? ' · etablissement de la mission' : ''}
            </Text>
          )}
        </View>

        {filtered.length > 0 ? (
          <>
            <View style={s.sectionIntro}>
              <Text style={s.sectionTitle}>
                {filtered.length} profil{filtered.length !== 1 ? 's' : ''} {isUrgentReplacementMode ? 'compatible' : 'disponible'}{filtered.length !== 1 ? 's' : ''}
              </Text>
              <Text style={s.sectionSub}>
                {isUrgentReplacementMode
                  ? 'Le serveur initial est exclu et tous les profils restants sont recontroles sur ce creneau.'
                  : 'Tous ont coche ce creneau et restent eligibles pour cette mission.'}
              </Text>
            </View>
            <View style={s.list}>
              {filtered.map((srv, i) => renderCard(srv, i, filtered.length))}
            </View>
          </>
        ) : (
          <View style={s.emptyCard}>
            <Text style={s.emptyEmoji}>📅</Text>
            <Text style={s.emptyTitle}>Aucun profil disponible pour ce creneau</Text>
            <Text style={s.emptySub}>
              Aucun serveur n&apos;a coche ce jour et ce creneau.{'\n'}
              Essayez d&apos;elargir le rayon ou de modifier les horaires.
            </Text>
            <View style={s.emptyCtas}>
              <TouchableOpacity style={s.emptyCtaBtn} onPress={() => setRayon(p => Math.min(p + 10, 100))} activeOpacity={0.8}>
                <Text style={s.emptyCtaBtnTxt}>Elargir le rayon (+10 km)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.emptyCtaBtn, s.emptyCtaBtnSec]} onPress={() => router.back()} activeOpacity={0.8}>
                <Text style={s.emptyCtaBtnSecTxt}>Modifier la mission</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      <Animated.View style={[s.sendBar, { transform: [{ translateY: barAnim.interpolate({ inputRange: [0,1], outputRange: [120,0] }) }], opacity: barAnim }]}>
        {chanceLabel && <Text style={s.sendBarHint}>{chanceLabel}</Text>}
        <TouchableOpacity style={[s.sendBarBtn, sending && s.sendBarBtnDisabled]} onPress={confirmerEnvoi} disabled={sending || nb === 0} activeOpacity={0.86}>
          <Text style={s.sendBarBtnTxt}>
            {sending
              ? 'Envoi...'
              : nb === 0
                ? 'Selectionnez au moins 1 profil'
                : isUrgentReplacementMode
                  ? nb === 1
                    ? 'Envoyer 1 demande urgente'
                    : `Envoyer ${nb} demandes urgentes`
                  : nb === 1
                    ? 'Contacter 1 profil interesse'
                    : `Contacter ${nb} profils interesses`}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  )
}

const s = StyleSheet.create({
  screen:         { flex: 1, backgroundColor: C.bg },
  loadWrap:       { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },
  scroll:         { flex: 1 },
  content:        { paddingBottom: 48 },
  contentWithBar: { paddingBottom: 120 },
  backBtn:  { paddingTop: 56, paddingHorizontal: 22, marginBottom: 6, alignSelf: 'flex-start' },
  backTxt:  { fontSize: 15, color: C.textSub, fontWeight: '700' },
  header:     { paddingTop: 18, paddingHorizontal: 22, paddingBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  eyebrow:    { fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted, marginBottom: 6 },
  title:      { fontSize: 34, fontWeight: '800', color: C.text, letterSpacing: -0.6, lineHeight: 38 },
  countBadge: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  countNum:   { fontSize: 28, fontWeight: '800', color: C.green, letterSpacing: -1 },
  countLabel: { fontSize: 11, color: C.muted, marginTop: 2 },
  missionBanner:    { marginHorizontal: 16, marginBottom: 10, backgroundColor: C.greenBg, borderRadius: 14, borderWidth: 1, borderColor: C.greenBd, paddingHorizontal: 14, paddingVertical: 10 },
  missionBannerTxt: { fontSize: 13, color: C.textSub, lineHeight: 19, fontWeight: '700' },
  missionBannerSubTxt: { marginTop: 6, fontSize: 12, color: C.textSub, lineHeight: 17, fontWeight: '600' },
  instrWrap: { marginHorizontal: 16, marginBottom: 12, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 10 },
  instrTxt:  { fontSize: 13, color: C.muted, lineHeight: 18 },
  searchWrap:  { marginHorizontal: 16, marginBottom: 14, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  searchIcon:  { fontSize: 15, marginRight: 8 },
  searchInput: { flex: 1, height: 46, fontSize: 14, color: C.text },
  searchClear: { fontSize: 14, color: C.muted, paddingLeft: 8 },
  rayonRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 20 },
  rayonBtn:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, marginRight: 8 },
  rayonBtnActive: { backgroundColor: C.greenBg, borderColor: C.greenBd },
  rayonTxt:       { fontSize: 13, color: C.muted, fontWeight: '500' },
  rayonTxtActive: { color: C.green },
  rayonVille:     { fontSize: 12, color: C.muted, marginLeft: 4, flex: 1 },
  sectionIntro: { marginHorizontal: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: C.text, marginBottom: 4 },
  sectionSub:   { fontSize: 13, color: C.muted, lineHeight: 18 },
  list:         { paddingHorizontal: 16 },
  card:         { backgroundColor: '#FDFCFA', borderRadius: 24, borderWidth: 1, borderColor: '#E7DED4', padding: 18, flexDirection: 'row', alignItems: 'flex-start', shadowColor: '#120E0A', shadowOpacity: 0.08, shadowOffset: { width: 0, height: 10 }, shadowRadius: 20, elevation: 4 },
  cardMargin:   { marginBottom: 10 },
  cardSelected: { borderColor: '#C56B3D', borderWidth: 2, backgroundColor: '#FFF4EC' },
  cardSent:     { borderColor: '#C56B3D', borderWidth: 2, backgroundColor: '#FFF4EC' },
  cardTop:      { borderColor: '#E2C0A4', backgroundColor: '#FFF6EE' },
  avatar:         { width: 52, height: 52, borderRadius: 26, backgroundColor: '#F6E7DB', borderWidth: 1, borderColor: '#E7D3C2', alignItems: 'center', justifyContent: 'center', marginRight: 14, flexShrink: 0 },
  avatarImageWrap:{ width: 52, height: 52, borderRadius: 26, marginRight: 14, flexShrink: 0, position: 'relative', overflow: 'hidden', borderWidth: 1, borderColor: '#E7D3C2', backgroundColor: '#F6E7DB' },
  avatarImage:    { width: '100%', height: '100%' },
  avatarSelected: { borderColor: '#D8B397' },
  avatarTxt:      { fontSize: 16, fontWeight: '800', color: '#2D241D' },
  avatarDot:      { position: 'absolute', bottom: 2, right: 2, width: 11, height: 11, borderRadius: 6, backgroundColor: C.green, borderWidth: 2, borderColor: '#FDFCFA' },
  cardBody:    { flex: 1 },
  cardHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  nameWrap:    { flexDirection: 'row', alignItems: 'center', flexShrink: 1, paddingRight: 10 },
  cardName:    { fontSize: 19, fontWeight: '800', color: '#191410', letterSpacing: -0.4 },
  metaRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardVille:   { flex: 1, fontSize: 13, color: '#4F453D', fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
  statusText: { flex: 1, fontSize: 12, color: '#2E8B57', fontWeight: '800' },
  statusTag: { fontSize: 11, fontWeight: '800', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, overflow: 'hidden' },
  statusTagNew: { backgroundColor: '#FBF5E8', borderColor: '#E8D4A0', color: '#B8893C' },
  statusTagExperience: { backgroundColor: '#FEF3EB', borderColor: '#F5C9A9', color: '#C46A3C' },
  infoLineText: { fontSize: 12, color: '#5E544C', fontWeight: '700', marginBottom: 14 },
  cardActions:      { flexDirection: 'row', alignItems: 'center' },
  selectBtn:        { backgroundColor: '#CD7344', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, minWidth: 132, alignItems: 'center' },
  selectBtnSel:     { backgroundColor: '#F7E5D7', borderWidth: 1, borderColor: '#E4B894' },
  selectBtnTxt:     { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  selectBtnTxtSel:  { color: '#C56B3D' },
  emptyCard:         { marginHorizontal: 16, backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 32, alignItems: 'center' },
  emptyEmoji:        { fontSize: 40, marginBottom: 16 },
  emptyTitle:        { fontSize: 18, fontWeight: '800', color: C.text, textAlign: 'center', marginBottom: 10 },
  emptySub:          { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 21, marginBottom: 24 },
  emptyCtas:         { gap: 10, width: '100%' },
  emptyCtaBtn:       { backgroundColor: C.green, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  emptyCtaBtnTxt:    { fontSize: 14, fontWeight: '700', color: C.greenDk },
  emptyCtaBtnSec:    { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.border },
  emptyCtaBtnSecTxt: { fontSize: 14, fontWeight: '700', color: C.textSub },
  sendBar:            { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 30 },
  sendBarHint:        { fontSize: 12, color: C.textSub, fontWeight: '600', textAlign: 'center', marginBottom: 10 },
  sendBarBtn:         { backgroundColor: C.green, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  sendBarBtnDisabled: { opacity: 0.6 },
  sendBarBtnTxt:      { fontSize: 14, fontWeight: '700', color: C.greenDk },
})

