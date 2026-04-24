import { useFocusEffect, useRouter } from 'expo-router'
import React, { useCallback, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native'
import PatronBottomNav from '../components/PatronBottomNav'
import { ANNONCE_COMPAT_SELECT, ANNONCE_COMPAT_WITH_WORKFLOW_SELECT, normalizeAnnonceRecords, type NormalizedAnnonceRecord } from '../lib/annonce-read'
import { cancelConfirmedAnnonce, closeDemandesForAnnonce, expireOpenAnnonces, selectServeurForMission, syncAnnoncesInProgress, updateAnnonceLifecycleStatus } from '../lib/annonces'
import { getMissionEngagementStage } from '../lib/mission-hiring'
import { EURO } from '../lib/currency'
import { fetchEtablissementNameMapByIds, fetchEtablissementsForPatron } from '../lib/etablissements'
import { saveEvaluation } from '../lib/evaluations'
import {
  acceptMissionRateCounterOffer,
  fetchPendingMissionNegotiationsForPatron,
  rejectMissionRateCounterOffer,
} from '../lib/mission-rate-negotiations'
import { isActiveMissionStatus, isOpenMissionStatus, normalizeMissionStatus, shouldHideMissionFromOpenLists } from '../lib/missions'
import { syncReferralRewardsForReferredUser } from '../lib/referrals'
import { getServerBusySlotMessage } from '../lib/server-availability'
import { detectMissionSlot } from '../lib/serveur-disponibilites'
import { getServeurExperienceBadgeLabel, syncServeurMissionStats } from '../lib/serveur-stats'
import { supabase } from '../lib/supabase'

type Annonce = Pick<
  NormalizedAnnonceRecord,
  'id' | 'poste' | 'date' | 'heure_debut' | 'heure_fin' | 'salaire' | 'ville' | 'statut' | 'serveur_id' | 'note' | 'etablissement_id' | 'checked_out_at' | 'payment_status'
>

type Candidature = {
  annonce_id: string
  serveur_id: string
  replacement_for_engagement_id?: string | null
  serveur_nom: string
  etablissement_nom: string
  poste: string
  ville: string
  date: string
  heure_debut: string
  heure_fin: string
}

type MissionContact = {
  annonce_id: string
  serveur_id: string
  nom: string
  photo_url: string | null
  missions_realisees: number
  statut: 'En attente' | 'Accepté' | 'Refusé' | 'À négocier salaire'
}

type PendingNegotiationItem = {
  id: string
  annonce_id: string
  serveur_id: string
  engagement_id: string | null
  serveur_nom: string
  etablissement_nom: string
  poste: string
  ville: string
  date: string
  heure_debut: string
  heure_fin: string
  current_rate: number
  counter_rate: number
}

type RatingModalState = {
  annonceId: string
  serveurId: string
  serveurNom: string
} | null

const getSeenCandidaturesStorageKey = (userId: string) => `dashboard_patron_seen_candidatures:${userId}`

const C = {
  bg:        '#F7F4EE',
  card:      '#FFFFFF',
  cardSoft:  '#F7F4EE',
  cardWarm:  '#FCF8F2',
  border:    '#EDE8DF',
  borderSoft:'#F0EBE3',
  title:     '#171614',
  text:      '#2A2723',
  muted:     '#B0A89C',
  soft:      '#7A7166',
  softDark:  '#5F574C',
  terra:     '#B95F33',
  terraDark: '#8F4825',
  terraBg:   '#FFF2E8',
  terraBd:   '#EEC2A3',
  green:     '#2E8B57',
  greenBg:   '#F0F8F3',
  greenBd:   '#C0DEC8',
  amber:     '#B8893C',
  amberBg:   '#FBF5E8',
  amberBd:   '#E8D4A0',
  red:       '#C84B4B',
  redBg:     '#FEF2F2',
  redBd:     '#F2CACA',
  shadow:    '#2B2118',
}

function statutConfig(statut: string) {
  switch (normalizeMissionStatus(statut)) {
    case 'open': return { label: 'En attente', bg: C.amberBg, color: C.amber, border: C.amberBd }
    case 'confirmed': return { label: 'Confirmée', bg: C.greenBg, color: C.green, border: C.greenBd }
    case 'in_progress': return { label: 'En cours', bg: C.greenBg, color: C.green, border: C.greenBd }
    case 'completed': return { label: 'Terminée', bg: '#F5F3F0', color: '#888', border: '#E0D9D0' }
    case 'no_show': return { label: 'Serveur absent', bg: C.redBg, color: C.red, border: C.redBd }
    case 'cancelled_by_patron': return { label: 'Annulée', bg: C.redBg, color: C.red, border: C.redBd }
    case 'cancelled_by_server': return { label: 'Annulée', bg: C.redBg, color: C.red, border: C.redBd }
    case 'expired': return { label: 'Annulée', bg: C.redBg, color: C.red, border: C.redBd }
    default: return { label: statut, bg: '#F5F3F0', color: '#888', border: '#E0D9D0' }
  }
}

function isPendingMissionStatus(statut: string | null | undefined) {
  return isOpenMissionStatus(statut)
}

function isAssignedMissionStatus(statut: string | null | undefined) {
  return isActiveMissionStatus(statut)
}

function isCompletedMissionStatus(mission: Pick<Annonce, 'serveur_id' | 'checked_out_at'>) {
  return Boolean(mission.serveur_id && mission.checked_out_at)
}

function getMissionContactBadgeMeta(completedMissions: number) {
  const label = getServeurExperienceBadgeLabel(completedMissions)

  if (label === 'Expert') {
    return {
      label,
      icon: '💎',
      bg: '#F3EEFF',
      bd: '#D8C9FF',
      txt: '#5C3E91',
    }
  }

  if (label === 'Pro') {
    return {
      label,
      icon: '★',
      bg: '#FEF1E8',
      bd: '#F0C5A8',
      txt: '#B8612E',
    }
  }

  if (label === 'Confirmé') {
    return {
      label,
      icon: '✔',
      bg: '#EEF8F2',
      bd: '#C8DED0',
      txt: '#2E6B4A',
    }
  }

  if (label === 'Nouveau') {
    return {
      label,
      icon: '●',
      bg: '#F6F4F1',
      bd: '#E6DDD2',
      txt: '#6A6258',
    }
  }

  if (label === 'Expert') {
    return {
      label,
      icon: '💎',
      bg: '#F3EEFF',
      bd: '#D8C9FF',
      txt: '#5C3E91',
    }
  }

  if (label === 'Pro') {
    return {
      label,
      icon: '★',
      bg: '#FEF1E8',
      bd: '#F0C5A8',
      txt: '#B8612E',
    }
  }

  if (label === 'Confirmé') {
    return {
      label,
      icon: '✔',
      bg: '#EEF8F2',
      bd: '#C8DED0',
      txt: '#2E6B4A',
    }
  }

  return {
    label,
    icon: '●',
    bg: '#F6F4F1',
    bd: '#E6DDD2',
    txt: '#6A6258',
  }
}

function StarDisplay({ note }: { note: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[1,2,3,4,5].map(n => (
        <View key={n} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: note >= n ? C.amber : '#D7CFC3' }} />
      ))}
    </View>
  )
}

function StarPicker({ note, onSelect }: { note: number; onSelect: (n: number) => void }) {
  return (
    <View style={s.starsRow}>
      {[1,2,3,4,5].map(n => (
        <TouchableOpacity key={n} style={s.starButton} onPress={() => onSelect(n)} activeOpacity={0.82}>
          <View style={[s.starCircle, note >= n && s.starCircleActive]}>
            <View style={[s.starDot, note >= n && s.starDotActive]} />
          </View>
        </TouchableOpacity>
      ))}
    </View>
  )
}

export default function DashboardPatron() {
  const router = useRouter()
  const scrollRef = useRef<ScrollView>(null)
  const ratingScrollRef = useRef<ScrollView>(null)
  const [activeMissionFilter, setActiveMissionFilter] = useState<'ouverte' | 'attribuee' | 'terminee'>('ouverte')

  const [annonces,           setAnnonces]           = useState<Annonce[]>([])
  const [prenom,             setPrenom]             = useState('')
  const [nomResto,           setNomResto]           = useState('')
  const [serveurs,           setServeurs]           = useState<{ [key: string]: string }>({})
  const [etablissementNames, setEtablissementNames] = useState<Record<string, string>>({})
  const [nbDispo,            setNbDispo]            = useState(0)
  const [candidaturesRecues, setCandidaturesRecues] = useState<Candidature[]>([])
  const [refreshing,         setRefreshing]         = useState(false)
  const [ratingModal,        setRatingModal]        = useState<RatingModalState>(null)
  const [ratingNote,         setRatingNote]         = useState(0)
  const [ratingComment,      setRatingComment]      = useState('')
  const [ratingReasons,      setRatingReasons]      = useState<string[]>([])
  const [ratingLoading,      setRatingLoading]      = useState(false)
  const [showCandidatures,   setShowCandidatures]   = useState(false)
  const [currentUserId,      setCurrentUserId]      = useState('')
  const [seenCandidatures,   setSeenCandidatures]   = useState<string[]>([])
  const [missionContacts,    setMissionContacts]    = useState<Record<string, MissionContact[]>>({})
  const [pendingNegotiations, setPendingNegotiations] = useState<PendingNegotiationItem[]>([])
  const [negotiationActionId, setNegotiationActionId] = useState<string | null>(null)
  const [captureRetryMissionId, setCaptureRetryMissionId] = useState<string | null>(null)

  const lowRatingReasons = ['retard', 'absence', 'attitude', 'niveau insuffisant']

  const chargerDonnees = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }
      setCurrentUserId(user.id)

      const { data: patron } = await supabase
        .from('patrons').select('prenom, nom_restaurant').eq('id', user.id).single()

      if (patron) {
        setPrenom(patron.prenom ?? '')
        const patronEtablissements = await fetchEtablissementsForPatron(user.id)
        const preferred = patronEtablissements[0] ?? null
        setNomResto(
          patronEtablissements.length > 1
            ? 'vos etablissements'
            : preferred?.nom ?? patron.nom_restaurant ?? ''
        )
      }

      let annoncesRows: any[] | null = null
      const { data: workflowData, error: workflowError } = await supabase
        .from('annonces').select(ANNONCE_COMPAT_WITH_WORKFLOW_SELECT).eq('patron_id', user.id)
        .order('created_at', { ascending: false })

      if (workflowError && /check_in_status|checked_in_at|checked_out_at|dpae_|contract_status|payment_status/i.test(String(workflowError.message ?? ''))) {
        const { data: compatData, error: compatError } = await supabase
          .from('annonces').select(ANNONCE_COMPAT_SELECT).eq('patron_id', user.id)
          .order('created_at', { ascending: false })

        if (!compatError) {
          annoncesRows = (compatData ?? []).map((item: any) => ({
            ...item,
            checked_out_at: null,
            payment_status: null,
          }))
        }
      } else if (!workflowError) {
        annoncesRows = workflowData ?? null
      }

      if (annoncesRows) {
        const normalizedRows = normalizeAnnonceRecords(annoncesRows as any[])
        const expiredAnnonceIds = normalizedRows
          .filter((annonce) => shouldHideMissionFromOpenLists(annonce.statut, annonce.date, annonce.heure_debut, annonce.heure_fin))
          .map((annonce) => annonce.id)

        const progressedAnnonceIds = await syncAnnoncesInProgress(normalizedRows as any[])

        if (expiredAnnonceIds.length > 0) {
          await expireOpenAnnonces(expiredAnnonceIds)
        }

        const normalizedAnnonces = normalizedRows.map((annonce) =>
          expiredAnnonceIds.includes(annonce.id)
            ? { ...annonce, statut: 'expired' }
            : progressedAnnonceIds.includes(annonce.id)
              ? { ...annonce, statut: 'in_progress' }
              : annonce
        )

        setAnnonces(normalizedAnnonces)
        const etablissementNameMap = await fetchEtablissementNameMapByIds(
          normalizedAnnonces.map((annonce) => annonce.etablissement_id).filter(Boolean) as string[]
        )
        setEtablissementNames(etablissementNameMap)

        const serveurIds = normalizedAnnonces.filter((a: any) => a.serveur_id).map((a: any) => a.serveur_id)
        if (serveurIds.length > 0) {
          const { data: serveursData } = await supabase
            .from('serveurs').select('id, prenom, nom').in('id', serveurIds)
          if (serveursData) {
            const map: { [key: string]: string } = {}
            serveursData.forEach((s: any) => { map[s.id] = `${s.prenom} ${s.nom}` })
            setServeurs(map)
          }
        } else {
          setServeurs({})
        }

        const annonceIds = normalizedAnnonces.map((a: any) => a.id)
        if (annonceIds.length > 0) {
          let demandes: any[] | null = null
          const { data: demandesWithReplacement, error: demandesError } = await supabase
            .from('demandes')
            .select('annonce_id, serveur_id, replacement_for_engagement_id, statut, initiateur')
            .in('annonce_id', annonceIds)

          if (demandesError && String(demandesError.message ?? '').includes('replacement_for_engagement_id')) {
            console.warn('dashboard_patron: fallback candidatures query without replacement_for_engagement_id', demandesError.message)
            const { data: legacyDemandes, error: legacyDemandesError } = await supabase
              .from('demandes')
              .select('annonce_id, serveur_id, statut, initiateur')
              .in('annonce_id', annonceIds)

            if (legacyDemandesError) {
              console.error('dashboard_patron: candidatures fallback error', legacyDemandesError)
            } else {
              demandes = (legacyDemandes ?? []).map((item: any) => ({
                ...item,
                replacement_for_engagement_id: null,
              }))
            }
          } else {
            demandes = demandesWithReplacement ?? null
          }

          const pendingNegotiations = await fetchPendingMissionNegotiationsForPatron(user.id)

          if (demandes && demandes.length > 0) {
            const pendingNegotiationKeys = new Set(
              pendingNegotiations.map((item) => `${item.mission_id}:${item.serveur_id}`)
            )
            const srvIds = [...new Set([
              ...demandes.map((c: any) => c.serveur_id),
              ...pendingNegotiations.map((item) => item.serveur_id),
            ])]
            const { data: srvData } = await supabase
              .from('serveurs').select('id, prenom, nom, photo_url, missions_realisees').in('id', srvIds)

            if (srvData) {
              const srvMap = new Map<string, any>()
              srvData.forEach((s: any) => { srvMap.set(s.id, s) })
              const annonceMap: { [key: string]: any } = {}
              normalizedAnnonces.forEach((a: any) => { annonceMap[a.id] = a })

              const candidaturesOuvertes = demandes.filter((c: any) => {
                const annonce = annonceMap[c.annonce_id]
                return c.initiateur === 'serveur' &&
                  c.statut === 'en_attente' &&
                  isPendingMissionStatus(annonce?.statut) &&
                  !shouldHideMissionFromOpenLists(annonce?.statut, annonce?.date, annonce?.heure_debut, annonce?.heure_fin)
              })

              const nextMissionContacts: Record<string, MissionContact[]> = {}
              demandes
                .filter((demande: any) => demande.initiateur === 'patron')
                .forEach((demande: any) => {
                  const annonce = annonceMap[demande.annonce_id]
                  if (!annonce || !isPendingMissionStatus(annonce.statut) || shouldHideMissionFromOpenLists(annonce.statut, annonce.date, annonce.heure_debut, annonce.heure_fin)) {
                    return
                  }

                  const serveur = srvMap.get(demande.serveur_id)
                  const missionsRealisees = Math.max(0, Number(serveur?.missions_realisees ?? 0) || 0)
                  const demandeStatut = String(demande.statut ?? '').toLowerCase()
                  const negotiationKey = `${demande.annonce_id}:${demande.serveur_id}`
                  const statut =
                    pendingNegotiationKeys.has(negotiationKey)
                      ? 'À négocier salaire'
                      : annonce.serveur_id === demande.serveur_id || demandeStatut === 'acceptee'
                        ? 'Accepté'
                        : demandeStatut === 'refusee'
                          ? 'Refusé'
                          : 'En attente'

                  const contact: MissionContact = {
                    annonce_id: demande.annonce_id,
                    serveur_id: demande.serveur_id,
                    nom: serveur?.prenom ? String(serveur.prenom) : 'Inconnu',
                    photo_url: serveur?.photo_url ?? null,
                    missions_realisees: missionsRealisees,
                    statut,
                  }

                  nextMissionContacts[demande.annonce_id] = [...(nextMissionContacts[demande.annonce_id] ?? []), contact]
                })

              const nextPendingNegotiations: PendingNegotiationItem[] = pendingNegotiations.map((item) => {
                const serveur = srvMap.get(item.serveur_id)
                const annonce = annonceMap[item.mission_id]

                return {
                  id: item.id,
                  annonce_id: item.mission_id,
                  serveur_id: item.serveur_id,
                  engagement_id: item.engagement_id,
                  serveur_nom: serveur?.prenom ? `${serveur.prenom} ${serveur.nom}` : 'Serveur',
                  etablissement_nom: annonce?.etablissement_id
                    ? etablissementNameMap[annonce.etablissement_id] ?? annonce?.ville ?? patron?.nom_restaurant ?? 'Etablissement'
                    : patron?.nom_restaurant ?? annonce?.ville ?? 'Etablissement',
                  poste: annonce?.poste ?? 'Mission',
                  ville: annonce?.ville ?? '',
                  date: annonce?.date ?? '',
                  heure_debut: annonce?.heure_debut ?? '',
                  heure_fin: annonce?.heure_fin ?? '',
                  current_rate: item.original_rate,
                  counter_rate: item.counter_rate,
                }
              })

              setMissionContacts(nextMissionContacts)
              setPendingNegotiations(nextPendingNegotiations)
              setCandidaturesRecues(candidaturesOuvertes.map((c: any) => ({
                annonce_id:  c.annonce_id,
                serveur_id:  c.serveur_id,
                replacement_for_engagement_id: c.replacement_for_engagement_id ?? null,
                serveur_nom: srvMap.get(c.serveur_id) ? `${srvMap.get(c.serveur_id).prenom} ${srvMap.get(c.serveur_id).nom}` : 'Inconnu',
                etablissement_nom: annonceMap[c.annonce_id]?.etablissement_id
                  ? etablissementNameMap[annonceMap[c.annonce_id].etablissement_id] ?? annonceMap[c.annonce_id]?.ville ?? patron?.nom_restaurant ?? 'Etablissement'
                  : patron?.nom_restaurant ?? annonceMap[c.annonce_id]?.ville ?? 'Etablissement',
                poste:       annonceMap[c.annonce_id]?.poste ?? 'Mission',
                ville:       annonceMap[c.annonce_id]?.ville ?? '',
                date:        annonceMap[c.annonce_id]?.date ?? '',
                heure_debut: annonceMap[c.annonce_id]?.heure_debut ?? '',
                heure_fin:   annonceMap[c.annonce_id]?.heure_fin ?? '',
              })))
            } else {
              setMissionContacts({})
              setPendingNegotiations([])
              setCandidaturesRecues([])
            }
          } else {
            setMissionContacts({})
            setPendingNegotiations(pendingNegotiations.map((item) => ({
              id: item.id,
              annonce_id: item.mission_id,
              serveur_id: item.serveur_id,
              engagement_id: item.engagement_id,
              serveur_nom: 'Serveur',
              etablissement_nom: patron?.nom_restaurant ?? 'Etablissement',
              poste: 'Mission',
              ville: '',
              date: '',
              heure_debut: '',
              heure_fin: '',
              current_rate: item.original_rate,
              counter_rate: item.counter_rate,
            })))
            setCandidaturesRecues([])
          }
        } else {
          setMissionContacts({})
          setPendingNegotiations([])
          setCandidaturesRecues([])
        }
      }

      const { count } = await supabase
        .from('serveurs').select('*', { count: 'exact', head: true }).eq('disponible', true)
      setNbDispo(count ?? 0)
    } catch (e) {
      console.error('chargerDonnees error:', e)
    }
  }, [router])

  useFocusEffect(useCallback(() => { chargerDonnees() }, [chargerDonnees]))

  const loadSeenCandidatures = useCallback(async (userId: string) => {
    try {
      const raw = await AsyncStorage.getItem(getSeenCandidaturesStorageKey(userId))
      const parsed = raw ? JSON.parse(raw) : []
      setSeenCandidatures(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [])
    } catch {
      setSeenCandidatures([])
    }
  }, [])

  const markCandidaturesAsSeen = useCallback(async () => {
    if (!currentUserId) return

    const currentKeys = candidaturesRecues.map((candidature) => `${candidature.annonce_id}:${candidature.serveur_id}`)
    const nextSeen = Array.from(new Set([...seenCandidatures, ...currentKeys]))

    setSeenCandidatures(nextSeen)
    await AsyncStorage.setItem(getSeenCandidaturesStorageKey(currentUserId), JSON.stringify(nextSeen))
  }, [candidaturesRecues, currentUserId, seenCandidatures])

  useFocusEffect(useCallback(() => {
    if (!currentUserId) return
    loadSeenCandidatures(currentUserId)
  }, [currentUserId, loadSeenCandidatures]))

  const onRefresh = async () => {
    setRefreshing(true)
    await chargerDonnees()
    setRefreshing(false)
  }

  const openRatingModal = (annonceId: string, serveurId: string, serveurNom: string) => {
    setRatingModal({ annonceId, serveurId, serveurNom })
    setRatingNote(0); setRatingComment(''); setRatingReasons([]); setRatingLoading(false)
  }

  const closeRatingModal = () => {
    setRatingModal(null)
    setRatingNote(0); setRatingComment(''); setRatingReasons([]); setRatingLoading(false)
  }

  const toggleRatingReason = (reason: string) => {
    setRatingReasons(prev => prev.includes(reason) ? prev.filter(r => r !== reason) : [...prev, reason])
  }

  const submitRating = async () => {
    if (!ratingModal || ratingNote === 0) { Alert.alert('Erreur', 'Veuillez choisir une note'); return }
    setRatingLoading(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        throw new Error('User not found')
      }

      const ratingPayload = {
        mission_id: ratingModal.annonceId,
        serveur_id: ratingModal.serveurId,
        patron_id: user.id,
        note: ratingNote,
        commentaire: ratingComment.trim() || null,
      }

      console.log('submitRating payload', ratingPayload)

      await saveEvaluation({
        serveurId: ratingModal.serveurId,
        missionId: ratingModal.annonceId,
        patronId: user.id,
        note: ratingNote,
        commentaire: ratingComment,
      })

      const { data: updatedAnnonce, error: updateAnnonceError } = await supabase
        .from('annonces')
        .update({ note: ratingNote })
        .eq('id', ratingModal.annonceId)
        .select('id, note')
        .single()

      if (updateAnnonceError || !updatedAnnonce) {
        console.log('submitRating annonce update error:', updateAnnonceError)
        throw updateAnnonceError ?? new Error('Annonce update failed')
      }

      const noteSauvegardee = updatedAnnonce.note === ratingPayload.note

      if (!noteSauvegardee) {
        throw new Error('Rating note not persisted on annonce')
      }

      await chargerDonnees()
      closeRatingModal()
      Alert.alert('Succes', 'Note et commentaire enregistres')
    } catch (e) {
      console.error('submitRating error:', e)
      console.log('submitRating full error', e)
      Alert.alert('Erreur', 'Impossible d enregistrer la note. Verifiez la table d avis et les droits Supabase.')
      setRatingLoading(false)
    }
  }

  const terminerMission = (annonceId: string) => {
    Alert.alert('Confirmer', 'Marquer cette mission comme terminee ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Confirmer',
        onPress: async () => {
          try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const { data: annonceData } = await supabase.from('annonces').select('statut').eq('id', annonceId).single()
            if (annonceData?.statut === 'terminee' || annonceData?.statut === 'completed') { Alert.alert('Information', 'Cette mission est deja comptabilisee.'); return }
            const result = await updateAnnonceLifecycleStatus(annonceId, 'completed')
            if (!result.ok) { Alert.alert('Erreur', 'Impossible de terminer la mission'); return }
            const annonceCourante = annonces.find(a => a.id === annonceId)
            const serveurId  = annonceCourante?.serveur_id ?? null
            const serveurNom = serveurId ? (serveurs[serveurId] ?? 'le prestataire') : 'le prestataire'

            if (serveurId && result.changed) {
              await syncServeurMissionStats(serveurId)
              await syncReferralRewardsForReferredUser(serveurId)
            }

            await chargerDonnees()
            if (serveurId) openRatingModal(annonceId, serveurId, serveurNom)
          } catch {
            Alert.alert('Erreur', 'Impossible de terminer la mission')
          }
        },
      },
    ])
  }

  const annulerMission = (annonceId: string) => {
    Alert.alert('Confirmer', 'Annuler cette mission ?', [
      { text: 'Retour', style: 'cancel' },
      { text: 'Annuler la mission', style: 'destructive', onPress: async () => {
        await closeDemandesForAnnonce(annonceId, 'annulee')
        await supabase.from('annonces').update({ statut: 'cancelled_by_patron' }).eq('id', annonceId)
        chargerDonnees()
      }},
    ])
  }

  const annulerMissionConfirmee = (annonceId: string) => {
    Alert.alert('Confirmer', 'Annuler cette mission selectionnee ?', [
      { text: 'Retour', style: 'cancel' },
      {
        text: 'Annuler la mission',
        style: 'destructive',
        onPress: async () => {
          const result = await cancelConfirmedAnnonce(annonceId, 'patron')
          if (!result.ok) {
            Alert.alert('Erreur', "Impossible d'annuler cette mission.")
            return
          }
          chargerDonnees()
        },
      },
    ])
  }

  const accepterCandidature = async (annonceId: string, serveurId: string, replacementForEngagementId?: string | null) => {
    Alert.alert('Confirmer', 'Selectionner ce profil pour la mission ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Selectionner', onPress: async () => {
        const result = await selectServeurForMission(annonceId, serveurId, { replacedEngagementId: replacementForEngagementId ?? null })
        if (!result.ok) {
          const targetCandidature = candidaturesRecues.find((item) => item.annonce_id === annonceId && item.serveur_id === serveurId) ?? null
          const busyMessage = targetCandidature
            ? getServerBusySlotMessage(detectMissionSlot(targetCandidature.heure_debut, targetCandidature.heure_fin), 'profile')
            : getServerBusySlotMessage(null, 'profile')
          Alert.alert(
            'Information',
            result.reason === 'already_assigned'
              ? 'Cette mission a deja ete pourvue.'
              : result.reason === 'worker_unavailable'
                ? busyMessage
              : 'Impossible de selectionner ce profil.'
          )
          return
        }
        chargerDonnees()
        setShowCandidatures(false)
      }},
    ])
  }

  const refuserCandidature = async (annonceId: string, serveurId: string) => {
    await supabase.from('demandes').update({ statut: 'refusee' }).eq('annonce_id', annonceId).eq('serveur_id', serveurId)
    chargerDonnees()
  }

  const handleAcceptNegotiation = async (item: PendingNegotiationItem) => {
    setNegotiationActionId(item.id)
    const result = await acceptMissionRateCounterOffer({
      negotiationId: item.id,
      engagementId: item.engagement_id,
    })
    setNegotiationActionId(null)

    if (!result.ok) {
      Alert.alert('Erreur', result.message)
      return
    }

    await chargerDonnees()
    Alert.alert('Succes', 'La negotiation a ete acceptee.')
  }

  const handleRejectNegotiation = async (item: PendingNegotiationItem) => {
    setNegotiationActionId(item.id)
    const result = await rejectMissionRateCounterOffer(item.id)
    setNegotiationActionId(null)

    if (!result.ok) {
      Alert.alert('Erreur', result.message)
      return
    }

    await chargerDonnees()
    Alert.alert('Succes', 'La negotiation a ete refusee.')
  }

  const handleRetryCapture = async (annonceId: string) => {
    setCaptureRetryMissionId(annonceId)
    try {
      const { data, error } = await supabase.functions.invoke('stripe-capture-mission-payment-intent', {
        body: { missionId: annonceId },
      })

      if (error || data?.error) {
        Alert.alert('Erreur', data?.error ?? error?.message ?? 'Impossible de relancer la capture.')
        return
      }

      await chargerDonnees()
      Alert.alert('Succes', 'La capture a bien ete relancee.')
    } finally {
      setCaptureRetryMissionId(null)
    }
  }

  const annoncesOuvertes   = annonces.filter(a => isPendingMissionStatus(a.statut) && !shouldHideMissionFromOpenLists(a.statut, a.date, a.heure_debut, a.heure_fin))
  const annoncesAttribuees = annonces.filter(a => isAssignedMissionStatus(a.statut))
  const annoncesTerminees  = annonces.filter(a => isCompletedMissionStatus(a))
  const nbTerminees       = annoncesTerminees.length
  const nbCandidatures    = candidaturesRecues.length
  const unseenCandidaturesCount = candidaturesRecues.filter((candidature) => {
    const key = `${candidature.annonce_id}:${candidature.serveur_id}`
    return !seenCandidatures.includes(key)
  }).length

  const filteredMissions = activeMissionFilter === 'ouverte' ? annoncesOuvertes
    : activeMissionFilter === 'attribuee' ? annoncesAttribuees : annoncesTerminees

  const filteredMissionTitle = activeMissionFilter === 'ouverte' ? 'Missions en attente'
    : activeMissionFilter === 'attribuee' ? 'Missions selectionnees' : 'Missions terminees'

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.terra} />}
      >
        {/* HEADER */}
        <View style={s.header}>
          <View>
            <Text style={s.nom}>{`Bonjour ${prenom || 'vous'}`}</Text>
            <Text style={s.headerVenue}>{nomResto || 'votre etablissement'}</Text>
            <Text style={s.headerSub}>{"G\u00e9rez vos missions et vos candidats en un coup d\u2019\u0153il"}</Text>
          </View>
        </View>

        {/* HERO */}
        <View style={s.hero}>
          <View style={s.heroTop}>
            <View style={{ flex: 1 }}>
              <Text style={s.heroTitle}>Besoin de renfort ?</Text>
              <Text style={s.heroSub}>
                {nbDispo > 0 ? `${nbDispo} profils disponibles autour de vous` : 'Publiez une mission pour relancer la recherche'}
              </Text>
            </View>
          </View>
          <TouchableOpacity style={s.heroCta} onPress={() => router.push('/poster-annonce')} activeOpacity={0.78}>
            <Text style={s.heroCtaTxt}>Publier une mission</Text>
          </TouchableOpacity>
        </View>

        {/* STATS — 4 cartes */}
        <View style={s.statsGrid}>
          <TouchableOpacity
            style={[s.statCard, s.statCardThird, activeMissionFilter === 'ouverte' && s.statCardActive]}
            onPress={() => setActiveMissionFilter('ouverte')}
            activeOpacity={0.8}
          >
            <Text style={[s.statNum, { color: C.amber }]}>{annoncesOuvertes.length}</Text>
            <Text style={s.statLbl}>En attente</Text>
            <Text style={s.statSub}>sans personnel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.statCard, s.statCardThird, activeMissionFilter === 'terminee' && s.statCardActive]}
            onPress={() => setActiveMissionFilter('terminee')}
            activeOpacity={0.8}
          >
            <Text style={[s.statNum, { color: C.softDark }]}>{nbTerminees}</Text>
            <Text style={s.statLbl}>Terminees</Text>
            <Text style={s.statSub}>avec succes</Text>
          </TouchableOpacity>

          {/* CARTE CANDIDATURES */}
          <TouchableOpacity
            style={[s.statCard, s.statCardThird, nbCandidatures > 0 && s.statCardAlert]}
            onPress={async () => {
              await markCandidaturesAsSeen()
              setShowCandidatures(true)
            }}
            activeOpacity={0.8}
          >
            {unseenCandidaturesCount > 0 && (
              <View style={s.statBadge}>
                <Text style={s.statBadgeTxt}>{unseenCandidaturesCount}</Text>
              </View>
            )}
            <View style={s.statNumRow}>
              <Text style={[s.statNum, { color: nbCandidatures > 0 ? '#C56B3D' : C.muted }]}>
                {nbCandidatures}
              </Text>
            </View>
            <Text style={[s.statLbl, nbCandidatures > 0 && s.statLblAlert]} numberOfLines={1}>
              Candidature
            </Text>
            <Text style={[s.statSub, nbCandidatures > 0 && s.statSubAlert]}>
              {nbCandidatures === 0 ? 'aucune en attente' : nbCandidatures === 1 ? 'candidat' : 'candidats'}
            </Text>
          </TouchableOpacity>
        </View>

        {annoncesAttribuees.length > 0 && (
          <View style={s.inProgressHintWrap}>
            <Text style={s.inProgressHintTxt}>
              {`${annoncesAttribuees.length} mission${annoncesAttribuees.length > 1 ? 's' : ''} en cours → voir onglet Missions`}
            </Text>
          </View>
        )}

        {/* MISSIONS FILTREES */}
        {filteredMissions.length > 0 && (
          <View style={s.section}>
            <View style={s.secRow}>
              <Text style={s.secTitle}>{filteredMissionTitle}</Text>
            </View>

            {filteredMissions.map((annonce, i) => {
              const cfg    = statutConfig(annonce.statut)
              const nomSrv = annonce.serveur_id ? serveurs[annonce.serveur_id] : null
              const contacts = missionContacts[annonce.id] ?? []

              if (activeMissionFilter === 'terminee') {
                return (
                  <View key={annonce.id} style={[s.histoCard, i < filteredMissions.length - 1 && s.cardMb]}>
                    <View style={s.acHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.histoPoste}>{annonce.poste}</Text>
                      <Text style={s.missionEtablissement}>
                        {annonce.etablissement_id ? etablissementNames[annonce.etablissement_id] ?? annonce.ville : annonce.ville}
                      </Text>
                      <Text style={s.histoMeta}>{annonce.ville} - {annonce.date}</Text>
                    </View>
                      <View style={[s.badge, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
                        <Text style={[s.badgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
                      </View>
                    </View>
                    {annonce.payment_status === 'capture_failed' && (
                      <View style={s.captureAlertCard}>
                        <Text style={s.captureAlertTitle}>Paiement non capturé. Une action est requise.</Text>
                        <Text style={s.captureAlertText}>{annonce.poste} - {annonce.date}</Text>
                        <TouchableOpacity
                          style={[s.captureRetryBtn, captureRetryMissionId === annonce.id && s.captureRetryBtnDisabled]}
                          onPress={() => handleRetryCapture(annonce.id)}
                          disabled={captureRetryMissionId === annonce.id}
                          activeOpacity={0.8}
                        >
                          <Text style={s.captureRetryBtnText}>
                            {captureRetryMissionId === annonce.id ? 'Reessai...' : 'Réessayer la capture'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    {!annonce.note && annonce.serveur_id && (
                      <TouchableOpacity
                        style={s.evalAction}
                        onPress={() => router.push({ pathname: '/evaluer-serveur', params: { annonceId: annonce.id, serveurId: annonce.serveur_id, serveurNom: nomSrv || 'le prestataire' } })}
            activeOpacity={0.8}
                      >
                        <Text style={s.evalActionText}>Evaluer le prestataire</Text>
                      </TouchableOpacity>
                    )}
                    {annonce.note != null && <View style={s.noteRow}><StarDisplay note={annonce.note} /></View>}
                  </View>
                )
              }

              return (
                <View key={annonce.id} style={[s.missionCard, i < filteredMissions.length - 1 && s.cardMb]}>
                  <View style={s.missionTop}>
                    <View style={s.missionTitleWrap}>
                      <Text style={s.missionTitle}>{annonce.poste}</Text>
                      <Text style={s.missionEtablissement}>
                        {annonce.etablissement_id ? etablissementNames[annonce.etablissement_id] ?? annonce.ville : annonce.ville}
                      </Text>
                      <Text style={s.missionSubtitle}>
                        {isPendingMissionStatus(annonce.statut) ? 'Mission a pourvoir' : getMissionEngagementStage({ statut: annonce.statut })}
                      </Text>
                    </View>
                    <View style={[s.statusBadge, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
                      <Text style={[s.statusBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                  </View>

                  <View style={s.missionInfoRow}>
                    <View style={s.missionInfoCard}>
                      <Text style={s.missionInfoLabel}>Date</Text>
                      <Text style={s.missionInfoValue}>{annonce.date}</Text>
                    </View>
                    <View style={s.missionInfoCard}>
                      <Text style={s.missionInfoLabel}>Horaire</Text>
                      <Text style={s.missionInfoValue}>{annonce.heure_debut} - {annonce.heure_fin}</Text>
                    </View>
                  </View>

                  <View style={s.missionFooter}>
                    <Text style={s.missionCity}>{annonce.ville}</Text>
                    <Text style={s.missionPrice}>{`${annonce.salaire}${EURO} / h brut`}</Text>
                  </View>

                  {isPendingMissionStatus(annonce.statut) && contacts.length > 0 && (
                    <View style={s.contactList}>
                      {contacts.map((contact) => (
                        <View key={`${contact.annonce_id}-${contact.serveur_id}`} style={s.contactRow}>
                          {(() => {
                            const badgeMeta = getMissionContactBadgeMeta(contact.missions_realisees)
                            return (
                              <>
                          {contact.photo_url ? (
                            <Image source={{ uri: contact.photo_url }} style={s.contactPhoto} />
                          ) : (
                            <View style={s.contactAvatar}>
                              <Text style={s.contactAvatarTxt}>
                                {contact.nom.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
                              </Text>
                            </View>
                          )}
                          <View style={s.contactMain}>
                            <Text style={s.contactName} numberOfLines={1}>{contact.nom}</Text>
                            <View style={[
                              s.contactScoreBadge,
                              {
                                backgroundColor: badgeMeta.bg,
                                borderColor: badgeMeta.bd,
                              },
                            ]}>
                              <Text style={[s.contactScoreBadgeIcon, { color: badgeMeta.txt }]}>{badgeMeta.icon}</Text>
                              <Text style={[s.contactScoreBadgeTxt, { color: badgeMeta.txt }]} numberOfLines={1}>{badgeMeta.label}</Text>
                            </View>
                          </View>
                          <View style={s.contactSide}>
                            <View style={[
                              s.contactStatusBadge,
                              contact.statut === 'Accepté'
                                ? s.contactStatusAccepted
                                : contact.statut === 'Refusé'
                                  ? s.contactStatusRefused
                                  : contact.statut === 'À négocier salaire'
                                    ? s.contactStatusNegotiation
                                    : s.contactStatusPending,
                            ]}>
                              <Text style={s.contactStatusBadgeTxt}>{contact.statut}</Text>
                            </View>
                            <TouchableOpacity
                              style={s.contactProfileBtn}
                              onPress={() => router.push({ pathname: '/profil-serveur-public', params: { serveurId: contact.serveur_id, annonceId: annonce.id } })}
                              activeOpacity={0.78}
                            >
                              <Text style={s.contactProfileBtnTxt}>Voir profil</Text>
                            </TouchableOpacity>
                          </View>
                              </>
                            )
                          })()}
                        </View>
                      ))}
                    </View>
                  )}

                  {isPendingMissionStatus(annonce.statut) && (
                    <View style={s.missionActionsRow}>
                      <TouchableOpacity
                        style={[s.primaryAction, s.primaryActionFlex]}
                        onPress={() => router.push({ pathname: '/serveurs-disponibles', params: { annonceId: annonce.id, ville: annonce.ville } })}
                        activeOpacity={0.78}
                      >
                        <Text style={s.primaryActionText}>Continuer la recherche</Text>
                        <Text style={s.primaryActionSubtext}>Proposez cette mission a d&apos;autres profils</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.softAction} onPress={() => annulerMission(annonce.id)} activeOpacity={0.8}>
                        <Text style={s.softActionText}>Annuler</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {isAssignedMissionStatus(annonce.statut) && (
                    <>
                      {nomSrv && (
                        <View style={s.assignedRow}>
                          <View style={s.assignedAvatar}>
                            <Text style={s.assignedAvatarText}>
                              {nomSrv.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()}
                            </Text>
                          </View>
                          <View style={s.assignedContent}>
                            <Text style={s.assignedLabel}>Serveur confirme</Text>
                            <Text style={s.assignedName}>{nomSrv}</Text>
                          </View>
                        </View>
                      )}
                      <View style={s.confirmedActionsCol}>
                        <TouchableOpacity style={s.secondaryAction} onPress={() => terminerMission(annonce.id)} activeOpacity={0.8}>
                          <Text style={s.secondaryActionText}>Marquer comme terminee</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.softActionDanger} onPress={() => annulerMissionConfirmee(annonce.id)} activeOpacity={0.8}>
                          <Text style={s.softActionDangerText}>Annuler la mission</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
              )
            })}
          </View>
        )}

        {/* ETAT VIDE */}
        {filteredMissions.length === 0 && (
          <View style={s.section}>
            <View style={s.emptyCard}>
              <Text style={s.emptyTitle}>
                {activeMissionFilter === 'ouverte' ? 'Aucune mission en attente'
                  : activeMissionFilter === 'attribuee' ? 'Aucune mission selectionnee'
                  : 'Aucune mission terminee'}
              </Text>
              <Text style={s.emptySub}>
                {activeMissionFilter === 'ouverte'
                  ? nbDispo > 0 ? `${nbDispo} profils disponibles a proximite.` : 'Publiez une mission pour trouver un extra.'
                  : activeMissionFilter === 'attribuee' ? 'Les missions selectionnees apparaitront ici.'
                  : 'Les missions terminees apparaitront ici.'}
              </Text>
              {activeMissionFilter === 'ouverte' && (
                <TouchableOpacity style={s.emptyCta} onPress={() => router.push('/poster-annonce')} activeOpacity={0.78}>
                  <Text style={s.emptyCtaTxt}>Creer une annonce</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </ScrollView>
      <PatronBottomNav />

      {/* MODAL NOTATION */}
      <Modal visible={ratingModal !== null} transparent animationType="slide" onRequestClose={closeRatingModal}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={closeRatingModal} />
          <KeyboardAvoidingView
            style={s.modalKeyboardWrap}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 22 : 0}
          >
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View style={s.modalSheet}>
                <ScrollView
                  ref={ratingScrollRef}
                  style={s.modalScroll}
                  contentContainerStyle={s.modalScrollContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  <View style={s.modalHandle} />
                  <Text style={s.modalTitle}>Evaluer le prestataire</Text>
                  <Text style={s.modalName}>{ratingModal?.serveurNom ?? 'Prestataire'}</Text>
                  <StarPicker note={ratingNote} onSelect={setRatingNote} />
                  {ratingNote > 0 && ratingNote <= 3 && (
                    <View style={s.reasonSection}>
                      <Text style={s.reasonTitle}>Raisons rapides</Text>
                      <View style={s.reasonWrap}>
                        {lowRatingReasons.map(reason => {
                          const selected = ratingReasons.includes(reason)
                          return (
                            <TouchableOpacity key={reason} style={[s.reasonChip, selected && s.reasonChipActive]} onPress={() => toggleRatingReason(reason)} activeOpacity={0.82}>
                              <Text style={[s.reasonChipText, selected && s.reasonChipTextActive]}>{reason}</Text>
                            </TouchableOpacity>
                          )
                        })}
                      </View>
                    </View>
                  )}
                  <TextInput
                    style={s.commentInput}
                    placeholder="Commentaire optionnel"
                    placeholderTextColor="#9A9388"
                    value={ratingComment}
                    onChangeText={setRatingComment}
                    onFocus={() => {
                      setTimeout(() => {
                        ratingScrollRef.current?.scrollToEnd({ animated: true })
                      }, 120)
                    }}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                  />
                  <TouchableOpacity style={[s.modalPrimaryBtn, ratingLoading && s.modalPrimaryBtnDisabled]} onPress={submitRating} disabled={ratingLoading} activeOpacity={0.78}>
                    <Text style={s.modalPrimaryBtnText}>{ratingLoading ? 'Validation...' : 'Valider la note'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.modalLaterBtn} onPress={closeRatingModal} activeOpacity={0.8}>
                    <Text style={s.modalLaterBtnText}>Noter plus tard</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* MODAL CANDIDATURES */}
      <Modal visible={showCandidatures} transparent animationType="slide" onRequestClose={() => setShowCandidatures(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setShowCandidatures(false)} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <View style={s.candModalHeader}>
              <Text style={s.candModalTitle}>Profils interesses a traiter</Text>
              {nbCandidatures + pendingNegotiations.length > 0 && (
                <View style={s.candModalBadge}>
                  <Text style={s.candModalBadgeTxt}>{nbCandidatures + pendingNegotiations.length}</Text>
                </View>
              )}
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {pendingNegotiations.length > 0 && (
                <View style={s.negotiationSection}>
                  <Text style={s.negotiationSectionTitle}>Negociations tarifaires en attente</Text>
                  {pendingNegotiations.map((item, index) => {
                    const isLoading = negotiationActionId === item.id
                    return (
                      <View key={item.id} style={[s.candCard, index < pendingNegotiations.length - 1 && s.cardMb]}>
                        <View style={s.negotiationHeaderRow}>
                          <View style={s.negotiationInfo}>
                            <Text style={s.candName}>{item.poste}</Text>
                            <Text style={s.candPoste}>{item.etablissement_nom}</Text>
                            <Text style={s.candMeta}>
                              {item.date}{item.heure_debut ? ` - ${item.heure_debut}` : ''}{item.heure_fin ? ` / ${item.heure_fin}` : ''}{item.ville ? ` - ${item.ville}` : ''}
                            </Text>
                            <Text style={s.negotiationServer}>Serveur : {item.serveur_nom}</Text>
                          </View>
                          <View style={s.negotiationBadge}>
                            <Text style={s.negotiationBadgeText}>Pending</Text>
                          </View>
                        </View>

                        <View style={s.negotiationRatesRow}>
                          <View style={s.negotiationRateCard}>
                            <Text style={s.negotiationRateLabel}>Tarif actuel</Text>
                            <Text style={s.negotiationRateValue}>{item.current_rate}{EURO} / h</Text>
                          </View>
                          <View style={s.negotiationRateCard}>
                            <Text style={s.negotiationRateLabel}>Tarif demande</Text>
                            <Text style={s.negotiationRateValue}>{item.counter_rate}{EURO} / h</Text>
                          </View>
                        </View>

                        <View style={s.actionsRow}>
                          <TouchableOpacity
                            style={[s.actionBtn, s.actionBtnTerra, { flex: 1 }, isLoading && s.actionBtnDisabled]}
                            onPress={() => handleAcceptNegotiation(item)}
                            activeOpacity={0.8}
                            disabled={isLoading}
                          >
                            <Text style={s.actionBtnTxtWhite}>{isLoading ? 'Traitement...' : 'Accepter'}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[s.actionBtn, s.actionBtnRefus, isLoading && s.actionBtnDisabled]}
                            onPress={() => handleRejectNegotiation(item)}
                            activeOpacity={0.8}
                            disabled={isLoading}
                          >
                            <Text style={[s.actionBtnTxt, { color: C.red }]}>{isLoading ? 'Traitement...' : 'Refuser'}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )
                  })}
                </View>
              )}

              {candidaturesRecues.length === 0 && pendingNegotiations.length === 0 ? (
                <View style={s.candEmptyWrap}>
                  <Text style={s.candEmptyTxt}>Aucun interet en attente</Text>
                  <Text style={s.candEmptySub}>Les profils interesses par vos missions apparaitront ici.</Text>
                </View>
              ) : (
                candidaturesRecues.map((c, i) => (
                  <View key={`${c.annonce_id}-${c.serveur_id}`} style={[s.candCard, i < candidaturesRecues.length - 1 && s.cardMb]}>
                    <View style={s.candTop}>
                      <View style={s.candAvatar}>
                        <Text style={s.candAvatarTxt}>
                          {c.serveur_nom.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.candName}>{c.serveur_nom}</Text>
                        <Text style={s.candPoste}>{c.poste}</Text>
                        <Text style={s.candMeta}>{c.etablissement_nom}</Text>
                        <Text style={s.candMeta}>{c.date} - {c.heure_debut} / {c.heure_fin} - {c.ville}</Text>
                      </View>
                    </View>

                    <TouchableOpacity
                      style={s.btnVoirProfil}
                      onPress={() => {
  setShowCandidatures(false)
  router.push({
    pathname: '/profil-serveur-public',
    params: {
      serveurId: c.serveur_id,
      annonceId: c.annonce_id,
    },
  })
}}
            activeOpacity={0.8}
                    >
                      <Text style={s.btnVoirProfilTxt}>Voir le profil</Text>
                    </TouchableOpacity>

                    <View style={s.actionsRow}>
                      <TouchableOpacity
                        style={[s.actionBtn, s.actionBtnTerra, { flex: 1 }]}
                        onPress={() => accepterCandidature(c.annonce_id, c.serveur_id, c.replacement_for_engagement_id)}
                        activeOpacity={0.8}
                      >
                        <Text style={s.actionBtnTxtWhite}>Selectionner</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.actionBtn, s.actionBtnRefus]}
                        onPress={() => { refuserCandidature(c.annonce_id, c.serveur_id) }}
                        activeOpacity={0.8}
                      >
                        <Text style={[s.actionBtnTxt, { color: C.red }]}>Refuser</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const s = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: C.bg },
  scroll:  { flex: 1 },
  content: { paddingBottom: 124 },

  header:    { paddingTop: 60, paddingHorizontal: 24, paddingBottom: 28, alignItems: 'flex-start' },
  eyebrow:   { fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: C.muted, marginBottom: 6, fontWeight: '500' },
  nom:       { fontSize: 32, fontWeight: '800', color: C.title, letterSpacing: -0.6, lineHeight: 36 },
  headerVenue: { marginTop: 8, fontSize: 16, fontWeight: '800', color: C.terraDark },
  headerSub: { marginTop: 6, fontSize: 13, lineHeight: 20, color: C.soft, fontWeight: '500' },
  nomAccent: { color: C.terra },

  hero:         { marginHorizontal: 20, backgroundColor: C.card, borderRadius: 26, paddingHorizontal: 22, paddingVertical: 18, borderWidth: 1, borderColor: C.border, shadowColor: C.shadow, shadowOpacity: 0.075, shadowOffset: { width: 0, height: 8 }, shadowRadius: 18, elevation: 3 },
  heroTop:      { marginBottom: 12 },
  heroTitle:    { fontSize: 22, lineHeight: 27, fontWeight: '800', color: C.title, letterSpacing: -0.7 },
  heroSub:      { marginTop: 6, fontSize: 13, lineHeight: 20, color: C.soft, fontWeight: '500' },
  heroCta:      { backgroundColor: C.terra, borderRadius: 17, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.terraDark, shadowColor: '#A95228', shadowOpacity: 0.18, shadowOffset: { width: 0, height: 6 }, shadowRadius: 12, elevation: 2 },
  heroCtaTxt:   { fontSize: 15, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.2 },

  statsGrid:       { flexDirection: 'row', flexWrap: 'wrap', margin: 20, marginTop: 24, marginBottom: 0, gap: 12 },
  statCardThird:   { width: '30.8%' },
  inProgressHintWrap: { marginHorizontal: 20, marginTop: 12, backgroundColor: C.cardWarm, borderWidth: 1, borderColor: C.borderSoft, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 12 },
  inProgressHintTxt:  { fontSize: 13, color: C.softDark, fontWeight: '600' },
  statCard:        { backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.border, padding: 15, shadowColor: C.shadow, shadowOpacity: 0.06, shadowOffset: { width: 0, height: 5 }, shadowRadius: 14, elevation: 2 },
  statCardQuarter: { width: '47.5%' },
  statCardActive:  { borderColor: C.terra, backgroundColor: C.terraBg },
  statCardAlert:   { borderColor: '#E6A873', backgroundColor: '#FFF6ED' },
  statBadge:       { position: 'absolute', top: 10, right: 10, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  statBadgeTxt:    { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
  statNumRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  statNum:         { fontSize: 34, fontWeight: '800', letterSpacing: -1.1, lineHeight: 36, marginBottom: 4 },
  statLbl:         { fontSize: 11, fontWeight: '700', color: C.text, textTransform: 'uppercase', letterSpacing: 0.7 },
  statLblAlert:    { color: '#1A1715' },
  statSub:         { fontSize: 11, color: C.muted, marginTop: 7, paddingTop: 7, borderTopWidth: 1, borderTopColor: C.borderSoft, lineHeight: 16 },
  statSubAlert:    { color: '#8A7B70', borderTopColor: '#F0D7C1' },

  section:     { paddingHorizontal: 20, paddingTop: 44 },
  secRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  secTitle:    { fontSize: 23, fontWeight: '800', color: C.title, letterSpacing: -0.6 },
  secBadge:    { width: 24, height: 24, borderRadius: 12, backgroundColor: C.terra, alignItems: 'center', justifyContent: 'center' },
  secBadgeTxt: { fontSize: 11, fontWeight: '800', color: '#fff' },

  cardMb: { marginBottom: 18 },

  missionCard:       { backgroundColor: '#FFFDFC', borderRadius: 28, padding: 22, borderWidth: 1, borderColor: '#EEE6DB', shadowColor: C.shadow, shadowOpacity: 0.065, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  missionTop:        { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 },
  missionTitleWrap:  { flex: 1, paddingRight: 12 },
  missionTitle:      { fontSize: 21, fontWeight: '800', color: C.title, marginBottom: 6, letterSpacing: -0.5 },
  missionEtablissement: { fontSize: 12, color: C.softDark, fontWeight: '700', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 },
  missionSubtitle:   { fontSize: 13, color: C.soft, lineHeight: 19 },
  missionInfoRow:    { flexDirection: 'row', gap: 10, marginBottom: 18 },
  missionInfoCard:   { flex: 1, backgroundColor: '#FBF7F1', borderRadius: 18, borderWidth: 1, borderColor: '#EFE5D8', paddingHorizontal: 14, paddingVertical: 12 },
  missionInfoLabel:  { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, color: C.muted, marginBottom: 6 },
  missionInfoValue:  { fontSize: 14, fontWeight: '700', color: C.text },
  missionFooter:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2, marginBottom: 18 },
  missionCity:       { fontSize: 14, color: C.softDark, fontWeight: '600' },
  missionPrice:      { fontSize: 15, color: C.terraDark, fontWeight: '800', letterSpacing: -0.2 },
  contactList:       { marginBottom: 22, gap: 16 },
  contactRow:        { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 14, backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#EEE4D7', paddingHorizontal: 16, paddingVertical: 16, shadowColor: C.shadow, shadowOpacity: 0.04, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 1 },
  contactPhoto:      { width: 48, height: 48, borderRadius: 24, backgroundColor: C.cardSoft, borderWidth: 2, borderColor: '#FFFFFF', shadowColor: C.shadow, shadowOpacity: 0.09, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  contactAvatar:     { width: 48, height: 48, borderRadius: 24, backgroundColor: C.cardSoft, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: C.shadow, shadowOpacity: 0.09, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  contactAvatarTxt:  { fontSize: 13, fontWeight: '800', color: C.terraDark },
  contactMain:       { flex: 1, minWidth: 0, gap: 8, paddingTop: 2 },
  contactName:       { fontSize: 16, fontWeight: '800', color: C.title, marginBottom: 2 },
  contactScoreBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, borderWidth: 1, borderColor: '#ECE3D7', backgroundColor: '#F6F4F1', paddingHorizontal: 10, paddingVertical: 6 },
  contactScoreBadgeIcon: { fontSize: 11 },
  contactScoreBadgeTxt: { fontSize: 11, fontWeight: '800', color: '#6A6258' },
  contactSide:       { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 2, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F2E9DE' },
  contactStatusBadge:{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, alignSelf: 'flex-start' },
  contactStatusPending: { backgroundColor: '#FFF6E7', borderColor: '#EDD7A2' },
  contactStatusAccepted: { backgroundColor: '#EEF8F2', borderColor: '#B9D8C1' },
  contactStatusRefused: { backgroundColor: '#FEF1F1', borderColor: '#E8C4C4' },
  contactStatusNegotiation: { backgroundColor: '#FEF1E8', borderColor: '#F0C5A8' },
  contactStatusBadgeTxt: { fontSize: 11, fontWeight: '900', color: '#3F382F' },
  contactProfileBtn: { minHeight: 42, minWidth: 112, borderRadius: 14, borderWidth: 1, borderColor: '#D6C7B5', backgroundColor: '#FFFDFC', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, shadowColor: C.shadow, shadowOpacity: 0.035, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  contactProfileBtnTxt: { fontSize: 13, fontWeight: '800', color: '#433C34' },
  missionActionsRow: { flexDirection: 'row', alignItems: 'stretch', gap: 10, marginTop: 2 },

  statusBadge:     { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, marginLeft: 10, opacity: 0.96 },
  statusBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  primaryAction:        { backgroundColor: C.terra, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.terraDark, shadowColor: '#A95228', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  primaryActionText:    { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  primaryActionSubtext: { marginTop: 4, color: 'rgba(255,255,255,0.78)', fontSize: 11, lineHeight: 15, fontWeight: '600', textAlign: 'center' },
  primaryActionFlex:    { flex: 1 },
  secondaryAction:      { backgroundColor: '#F6F1E8', borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, shadowColor: C.shadow, shadowOpacity: 0.03, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  secondaryActionText:  { color: C.softDark, fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  confirmedActionsCol:  { gap: 10 },
  softAction:           { paddingHorizontal: 16, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  softActionText:       { color: C.softDark, fontSize: 14, fontWeight: '700', letterSpacing: -0.1 },
  softActionDanger:     { borderRadius: 16, borderWidth: 1, borderColor: C.redBd, backgroundColor: C.redBg, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  softActionDangerText: { color: C.red, fontSize: 14, fontWeight: '700', letterSpacing: -0.1 },

  assignedRow:        { flexDirection: 'row', alignItems: 'center', marginBottom: 14, backgroundColor: C.cardWarm, borderRadius: 16, borderWidth: 1, borderColor: C.borderSoft, padding: 12 },
  assignedAvatar:     { width: 40, height: 40, borderRadius: 20, backgroundColor: C.cardSoft, alignItems: 'center', justifyContent: 'center', marginRight: 10, borderWidth: 1, borderColor: C.border },
  assignedAvatarText: { fontSize: 12, fontWeight: '700', color: C.title },
  assignedContent:    { flex: 1 },
  assignedLabel:      { fontSize: 11, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  assignedName:       { fontSize: 14, fontWeight: '700', color: C.text },

  badge:    { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, opacity: 0.96 },
  badgeTxt: { fontSize: 11, fontWeight: '800', letterSpacing: 0.25 },

  emptyCard:   { backgroundColor: C.card, borderRadius: 24, borderWidth: 1, borderColor: C.border, padding: 28, alignItems: 'center', shadowColor: C.shadow, shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  emptyTitle:  { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 8 },
  emptySub:    { fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  emptyCta:    { backgroundColor: C.terra, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12 },
  emptyCtaTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },

  histoCard:      { backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.border, padding: 20, shadowColor: C.shadow, shadowOpacity: 0.055, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  acHeader:       { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  histoPoste:     { fontSize: 16, fontWeight: '700', color: C.softDark, marginBottom: 3 },
  histoMeta:      { fontSize: 12, color: C.muted },
  captureAlertCard: { marginTop: 12, backgroundColor: C.redBg, borderRadius: 16, borderWidth: 1, borderColor: C.redBd, padding: 12, gap: 8 },
  captureAlertTitle: { fontSize: 13, fontWeight: '800', color: C.red },
  captureAlertText: { fontSize: 12, color: C.softDark, lineHeight: 18 },
  captureRetryBtn: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: C.redBd, paddingHorizontal: 12, paddingVertical: 8 },
  captureRetryBtnDisabled: { opacity: 0.6 },
  captureRetryBtnText: { fontSize: 12, fontWeight: '800', color: C.red },
  evalAction:     { backgroundColor: C.amberBg, borderWidth: 1, borderColor: C.amberBd, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  evalActionText: { fontSize: 14, fontWeight: '700', color: C.amber },
  noteRow:        { paddingTop: 8 },

  // MODAL NOTATION
  modalOverlay:            { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,22,20,0.34)' },
  modalBackdrop:           { flex: 1 },
  modalKeyboardWrap:       { justifyContent: 'flex-end' },
  modalSheet:              { backgroundColor: C.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, maxHeight: '88%', borderTopWidth: 1, borderTopColor: C.border },
  modalScroll:             { flexGrow: 0 },
  modalScrollContent:      { paddingBottom: 4 },
  modalHandle:             { alignSelf: 'center', width: 44, height: 5, borderRadius: 999, backgroundColor: C.border, marginBottom: 14 },
  modalTitle:              { fontSize: 20, fontWeight: '800', color: C.title, textAlign: 'center', marginBottom: 8, letterSpacing: -0.3 },
  modalName:               { fontSize: 15, fontWeight: '700', color: C.softDark, textAlign: 'center', marginBottom: 18 },
  starsRow:                { flexDirection: 'row', justifyContent: 'center', marginBottom: 18, gap: 10 },
  starButton:              { padding: 4 },
  starCircle:              { width: 48, height: 48, borderRadius: 14, backgroundColor: C.cardSoft, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  starCircleActive:        { backgroundColor: C.terraBg, borderColor: C.terraBd },
  starDot:                 { width: 18, height: 18, borderRadius: 9, backgroundColor: C.muted },
  starDotActive:           { backgroundColor: C.terra },
  reasonSection:           { marginBottom: 16 },
  reasonTitle:             { fontSize: 13, fontWeight: '700', color: C.softDark, marginBottom: 10 },
  reasonWrap:              { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonChip:              { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.cardSoft },
  reasonChipActive:        { backgroundColor: C.terraBg, borderColor: C.terraBd },
  reasonChipText:          { fontSize: 13, fontWeight: '600', color: C.softDark },
  reasonChipTextActive:    { color: C.terraDark },
  commentInput:            { minHeight: 100, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.cardWarm, paddingHorizontal: 14, paddingVertical: 14, textAlignVertical: 'top', fontSize: 14, color: C.text, marginBottom: 12 },
  modalPrimaryBtn:         { backgroundColor: C.terra, borderRadius: 16, paddingVertical: 15, alignItems: 'center', borderWidth: 1, borderColor: C.terraDark },
  modalPrimaryBtnDisabled: { opacity: 0.7 },
  modalPrimaryBtnText:     { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  modalLaterBtn:           { alignItems: 'center', paddingTop: 12, paddingBottom: 2 },
  modalLaterBtnText:       { fontSize: 14, fontWeight: '600', color: C.soft },

  // MODAL CANDIDATURES
  candModalHeader:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  candModalTitle:    { fontSize: 20, fontWeight: '800', color: C.title, letterSpacing: -0.3 },
  candModalBadge:    { width: 24, height: 24, borderRadius: 12, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  candModalBadgeTxt: { fontSize: 11, fontWeight: '800', color: '#fff' },
  candEmptyWrap:     { paddingVertical: 32, alignItems: 'center' },
  candEmptyTxt:      { fontSize: 16, fontWeight: '700', color: C.muted, marginBottom: 8 },
  candEmptySub:      { fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 18 },
  negotiationSection: { marginBottom: 18 },
  negotiationSectionTitle: { fontSize: 14, fontWeight: '800', color: C.softDark, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  negotiationHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 },
  negotiationInfo: { flex: 1 },
  negotiationServer: { marginTop: 8, fontSize: 12, fontWeight: '700', color: C.softDark },
  negotiationBadge: { borderRadius: 999, borderWidth: 1, borderColor: '#F0C5A8', backgroundColor: '#FEF1E8', paddingHorizontal: 10, paddingVertical: 6 },
  negotiationBadgeText: { fontSize: 11, fontWeight: '800', color: '#B8612E' },
  negotiationRatesRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  negotiationRateCard: { flex: 1, backgroundColor: C.cardSoft, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10 },
  negotiationRateLabel: { fontSize: 11, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  negotiationRateValue: { fontSize: 15, fontWeight: '800', color: C.title },
  candCard:          { backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.border, padding: 18, shadowColor: C.shadow, shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  candTop:           { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  candAvatar:        { width: 44, height: 44, borderRadius: 22, backgroundColor: C.cardSoft, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  candAvatarTxt:     { fontSize: 13, fontWeight: '700', color: C.title },
  candName:          { fontSize: 16, fontWeight: '700', color: C.title, marginBottom: 2 },
  candPoste:         { fontSize: 13, color: C.soft, marginBottom: 2 },
  candMeta:          { fontSize: 11, color: C.muted },

  btnVoirProfil:    { backgroundColor: C.cardSoft, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 10, alignItems: 'center', marginBottom: 10 },
  btnVoirProfilTxt: { fontSize: 13, fontWeight: '700', color: C.softDark },
  actionsRow:        { flexDirection: 'row', gap: 8 },
  actionBtn:         { borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1 },
  actionBtnDisabled: { opacity: 0.6 },
  actionBtnTerra:    { backgroundColor: C.terra, borderColor: C.terra },
  actionBtnRefus:    { backgroundColor: C.redBg, borderColor: C.redBd, paddingHorizontal: 16 },
  actionBtnTxt:      { fontSize: 13, fontWeight: '700' },
  actionBtnTxtWhite: { fontSize: 13, fontWeight: '700', color: '#fff' },
})
