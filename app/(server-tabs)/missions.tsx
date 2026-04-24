import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Dimensions, Image, Modal, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { cancelConfirmedAnnonce, expireOpenAnnonces, markMissionCheckOut, selectServeurForMission, syncAnnoncesInProgress } from '../../lib/annonces'
import { ANNONCE_COMPAT_SELECT, ANNONCE_COMPAT_WITH_WORKFLOW_SELECT, normalizeAnnonceRecords } from '../../lib/annonce-read'
import { fetchContractMapForEngagements, getContractWarnings, type ContractRecord } from '../../lib/contracts'
import { EURO } from '../../lib/currency'
import { fetchEngagementMapForMissions, isActiveEngagementStatus, normalizeEngagementStatus } from '../../lib/engagements'
import { fetchEtablissementNameMapByIds } from '../../lib/etablissements'
import { getWorkerInterestLabel } from '../../lib/mission-hiring'
import {
  createMissionRateCounterOffer,
  fetchMissionNegotiationForServer,
  getMissionRateNegotiationEligibility,
  type MissionRateNegotiationEligibility,
  type MissionRateNegotiationRecord,
} from '../../lib/mission-rate-negotiations'
import { ACTIVE_MISSION_READ_STATUSES, COMPLETED_MISSION_READ_STATUSES, hasMissionEnded, isActiveMissionStatus, isOpenMissionStatus, normalizeMissionStatus, shouldHideMissionFromOpenLists } from '../../lib/missions'
import { getCheckInBlockMessage, getCheckOutBlockMessage, getMissionValidationSummary, type MissionValidationSnapshot } from '../../lib/mission-validation'
import { getNearbyOffresForServeur, OffreProche } from '../../lib/offres'
import { resolveAccountRole } from '../../lib/auth-role'
import { getServerBusySlotMessage } from '../../lib/server-availability'
import { detectMissionSlot } from '../../lib/serveur-disponibilites'
import { supabase } from '../../lib/supabase'
import { fetchWorkerTrackedApplications, getWorkerTrackedApplicationTone, type WorkerTrackedApplication } from '../../lib/worker-applications'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const PERF_RIGHT_WIDTH = Math.floor((SCREEN_WIDTH - 32 - 10) * 0.35)
const C = { bg: '#F6F1E8', card: '#FFFCF8', cardSoft: '#F8F2E8', border: '#E8DED0', borderSoft: '#F0E7DB', title: '#1A1612', textSoft: '#6A6157', textMuted: '#9C9287', accent: '#1F6B45', accentSoft: '#EFF7F1', accentSoftBorder: '#C9DECF', gold: '#B8893C', terra: '#C46A3C', terraBg: '#FEF4EB', terraBd: '#F2CFB4', red: '#C84B4B', redBg: '#FEF2F2', redBd: '#F0CECE' }

interface Serveur { id: string; prenom: string; nom: string; ville: string; disponible: boolean; score: number | null; missions_realisees: number | null; missions_acceptees: number | null; missions_annulees: number | null; rayon: number; lat: number | null; lng: number | null; photo_url?: string | null }
interface OffreRecue { demande_id: string; annonce_id: string; poste: string; etablissement_id?: string | null; ville: string; date: string; heure_debut: string; heure_fin: string; salaire: number; nom_restaurant: string; patron_photo_url?: string | null; description?: string | null }
interface MissionActive { id: string; poste: string; etablissement_id?: string | null; ville: string; date: string; heure_debut: string; heure_fin: string; salaire: number; statut: string; presence_confirmation_status?: string | null; contract_status?: string | null; payment_status?: string | null; check_in_status?: string | null; dpae_done?: boolean | null; dpae_status?: string | null; checked_in_at?: string | null; checked_out_at?: string | null; check_out_requested_by?: string | null; check_out_requested_at?: string | null; check_out_confirmed_at?: string | null; engagement_status?: string | null; nom_restaurant: string; patron_photo_url?: string | null }
interface MissionPendingServer { demande_id: string; annonce_id: string; poste: string; etablissement_id?: string | null; ville: string; date: string; heure_debut: string; heure_fin: string; salaire: number; statut: string; nom_restaurant: string; patron_photo_url?: string | null; status_label: string; status_hint: string }
interface MissionFinished { id: string; poste: string; etablissement_id?: string | null; ville: string; date: string; heure_debut: string; heure_fin: string; salaire: number; statut: string; nom_restaurant: string; patron_photo_url?: string | null }
type MissionCandidature = WorkerTrackedApplication
type NegotiationTargetMission = Pick<OffreProche, 'id' | 'poste' | 'salaire' | 'nom_restaurant'>

const NET_ESTIMATE_RATIO = 0.75
const roundMoney = (value: number) => Math.round(value * 100) / 100
const parseMoneyInput = (value: string) => Number(String(value ?? '').replace(',', '.'))
const netEstime = (s: number) => roundMoney(s * NET_ESTIMATE_RATIO)
const brutDepuisNetEstime = (net: number) => roundMoney(net / NET_ESTIMATE_RATIO)
const posteInitiale = (p: string) => p?.slice(0, 2).toUpperCase() ?? '??'
function posteColor(p: string) { const l = p.toLowerCase(); if (l.includes('bar')) return '#C46A3C'; if (l.includes('chef') || l.includes('rang')) return '#2E8B57'; if (l.includes('runner')) return '#B8893C'; return '#9A9388' }
function formatDateFr(d: string) { try { return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) } catch { return d } }
const formatDistance = (km: number) => (km < 1 ? '< 1 km' : `${Math.round(km)} km`)
function tauxPresence(r: number, a: number, n: number) { void a; const total = r + n; if (total <= 0) return 100; return Math.max(0, Math.min(100, Math.round((r / total) * 100))) }
const tauxLabel = (t: number) => (t >= 95 ? 'Très fiable' : t >= 80 ? 'Fiable' : 'En progression')
function getPresenceTone(t: number) { if (t >= 95) return { bg: '#E8F5ED', border: '#CFE7D8', text: C.accent }; if (t >= 80) return { bg: '#F7EEDC', border: '#E8D4AD', text: C.gold }; return { bg: '#F3EEE6', border: '#E5D8C7', text: '#8B6F47' } }
const initialesAvatar = (p: string, n: string) => `${p?.[0] ?? ''}${n?.[0] ?? ''}`.toUpperCase()
const initialesRestaurant = (nom: string) => `${nom?.slice(0, 2) ?? ''}`.toUpperCase() || '??'
function renderMissionAvatar(photoUrl: string | null | undefined, label: string, fallbackColor: string) {
  return (
    <View style={[s.iconWrap, { backgroundColor: `${fallbackColor}18` }]}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={s.iconImage} resizeMode="cover" />
      ) : (
        <Text style={[s.iconTxt, { color: fallbackColor }]}>{initialesRestaurant(label)}</Text>
      )}
    </View>
  )
}
function getNegotiationIncrementLabel(eligibility: MissionRateNegotiationEligibility | null | undefined) {
  if (!eligibility?.allowed) return null
  const increment = Math.round((eligibility.maxAllowedRate - eligibility.baseRate) * 100) / 100
  if (increment <= 0) return null
  return `Négocier +${increment}${EURO}/h`
}
function getNegotiationButtonLabel(eligibility: MissionRateNegotiationEligibility | null | undefined) {
  return getNegotiationIncrementLabel(eligibility) ?? 'Négocier le tarif'
}
function getNegotiationDisabledReason(eligibility: MissionRateNegotiationEligibility | null | undefined) {
  if (!eligibility || eligibility.allowed) return null
  const reasons = (eligibility.reasons ?? []).map((reason) => String(reason ?? '').toLowerCase())
  if (reasons.some((reason) => reason.includes('badge'))) return 'Badge insuffisant pour négocier'
  if (reasons.some((reason) => reason.includes('présence') || reason.includes('presence'))) return 'Présence insuffisante : 90% requis'
  if (reasons.some((reason) => reason.includes('note') || reason.includes('4/5'))) return 'Note insuffisante : 4/5 minimum requis'
  return null
}
function buildMissionValidationSnapshot(mission: MissionActive, contract: ContractRecord | null): MissionValidationSnapshot { return { statut: mission.statut, presence_confirmation_status: mission.presence_confirmation_status ?? null, contract_status: contract?.status ?? null, payment_status: mission.payment_status ?? null, check_in_status: mission.check_in_status ?? null, dpae_done: mission.dpae_done ?? null, dpae_status: mission.dpae_status ?? null, date: mission.date, heure_debut: mission.heure_debut, heure_fin: mission.heure_fin, engagement_status: mission.engagement_status ?? null, engagement_checked_in_at: mission.checked_in_at ?? null, engagement_checked_out_at: mission.checked_out_at ?? null } }
function getPendingServerMissionStatus(statut: string | null | undefined) {
  const normalized = normalizeMissionStatus(statut)

  if (normalized === 'confirmed' || normalized === 'in_progress') {
    return {
      label: 'Engagement en attente',
      hint: 'Votre disponibilité est confirmée. La mission passe au contrat et aux formalités.',
    }
  }

  return {
    label: 'Disponibilité confirmée',
    hint: 'Votre réponse a bien été envoyée. Le patron finalise la mission.',
  }
}
async function getCurrentUserId() { const { data: { user } } = await supabase.auth.getUser(); return user?.id ?? null }
async function getServeurById(id: string): Promise<Serveur | null> { const { data, error } = await supabase.from('serveurs').select('id, prenom, nom, ville, disponible, score, missions_realisees, missions_acceptees, missions_annulees, rayon, lat, lng, photo_url').eq('id', id).single(); if (error || !data) return null; return data as Serveur }
function dedupeAnnoncesById(rows: any[]) {
  const map = new Map<string, any>()
  for (const row of rows) {
    const id = String(row?.id ?? '').trim()
    if (!id || map.has(id)) continue
    map.set(id, row)
  }
  return [...map.values()]
}
function isWorkflowAnnonceSchemaError(error: unknown) {
  return /check_in_status|checked_in_at|checked_out_at|check_out_requested_|check_out_confirmed_at|dpae_|contract_status|payment_status/i.test(
    String((error as { message?: string } | null)?.message ?? '')
  )
}
async function fetchAnnoncesWithWorkflowFallback(
  label: string,
  runQuery: (selectClause: string) => any
) {
  const workflowResult = await runQuery(ANNONCE_COMPAT_WITH_WORKFLOW_SELECT)
  if (!workflowResult.error) {
    return workflowResult.data ?? []
  }

  if (!isWorkflowAnnonceSchemaError(workflowResult.error)) {
    console.warn('server missions annonces query failed', {
      label,
      error: {
        message: workflowResult.error.message,
        code: workflowResult.error.code ?? null,
        details: workflowResult.error.details ?? null,
        hint: workflowResult.error.hint ?? null,
      },
    })
    return []
  }

  console.warn('server missions annonces workflow fallback', {
    label,
    error: {
      message: workflowResult.error.message,
      code: workflowResult.error.code ?? null,
      details: workflowResult.error.details ?? null,
      hint: workflowResult.error.hint ?? null,
    },
  })

  const compatResult = await runQuery(ANNONCE_COMPAT_SELECT)
  if (compatResult.error) {
    console.warn('server missions annonces compat query failed', {
      label,
      error: {
        message: compatResult.error.message,
        code: compatResult.error.code ?? null,
        details: compatResult.error.details ?? null,
        hint: compatResult.error.hint ?? null,
      },
    })
    return []
  }

  return (compatResult.data ?? []).map((row: any) => ({
    ...row,
    checked_in_at: null,
    checked_out_at: null,
    check_in_status: null,
    presence_confirmation_status: null,
    contract_status: null,
    payment_status: null,
    dpae_done: null,
    dpae_status: null,
    dpae_done_at: null,
    dpae_done_by: null,
    dpae_payload_snapshot: null,
    check_out_requested_by: null,
    check_out_requested_at: null,
    check_out_confirmed_at: null,
  }))
}

export default function MissionsServeurScreen() {
  const params = useLocalSearchParams<{ focus?: string | string[]; upcoming?: string | string[] }>()
  const router = useRouter()
  const [serveur, setServeur] = useState<Serveur | null>(null)
  const [annonces, setAnnonces] = useState<OffreProche[]>([])
  const [offresRecues, setOffresRecues] = useState<OffreRecue[]>([])
  const [missionsEnAttente, setMissionsEnAttente] = useState<MissionPendingServer[]>([])
  const [missionsActives, setMissionsActives] = useState<MissionActive[]>([])
  const [missionsTerminees, setMissionsTerminees] = useState<MissionFinished[]>([])
  const [mesCandidatures, setMesCandidatures] = useState<MissionCandidature[]>([])
  const [contracts, setContracts] = useState<Record<string, ContractRecord>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [postulatingAnnonceId, setPostulatingAnnonceId] = useState<string | null>(null)
  const [expandedOpportunityId, setExpandedOpportunityId] = useState<string | null>(null)
  const [negotiations, setNegotiations] = useState<Record<string, MissionRateNegotiationRecord | null>>({})
  const [proposalNegotiationEligibility, setProposalNegotiationEligibility] = useState<Record<string, MissionRateNegotiationEligibility | null>>({})
  const [opportunityNegotiationEligibility, setOpportunityNegotiationEligibility] = useState<Record<string, MissionRateNegotiationEligibility | null>>({})
  const [negotiationTarget, setNegotiationTarget] = useState<NegotiationTargetMission | null>(null)
  const [negotiationEligibility, setNegotiationEligibility] = useState<MissionRateNegotiationEligibility | null>(null)
  const [negotiationRateInput, setNegotiationRateInput] = useState('')
  const [negotiationLoading, setNegotiationLoading] = useState(false)
  const [negotiationSubmitting, setNegotiationSubmitting] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const userId = await getCurrentUserId()
      if (!userId) { router.replace('/'); return }
      const srv = await getServeurById(userId)
      if (!srv) { router.replace('/'); return }
      setServeur(srv)
      const nearbyOffres = await getNearbyOffresForServeur(userId, undefined, 3)
      setAnnonces(nearbyOffres)
      setMesCandidatures(await fetchWorkerTrackedApplications(userId))
      const negotiationEntries = await Promise.all(
        nearbyOffres.map(async (offre) => {
          const negotiation = await fetchMissionNegotiationForServer(userId, offre.id)
          return [offre.id, negotiation?.status === 'rejected' ? null : negotiation] as const
        })
      )
      setNegotiations(Object.fromEntries(negotiationEntries))
      const nearbyEligibilityEntries = await Promise.all(
        nearbyOffres.map(async (offre) => {
          const eligibility = await getMissionRateNegotiationEligibility(userId, offre.id)
          return [offre.id, eligibility] as const
        })
      )
      setOpportunityNegotiationEligibility(Object.fromEntries(nearbyEligibilityEntries))

      const [{ data: engagementRows, error: engagementRowsError }, confirmedAnnonces] = await Promise.all([
        supabase
          .from('engagements')
          .select('id, mission_id, patron_id, serveur_id, status, created_at, checked_in_at, checked_out_at')
          .eq('serveur_id', userId)
          .in('status', ['draft', 'pending_signature', 'confirmed', 'active'])
          .order('created_at', { ascending: false }),
        fetchAnnoncesWithWorkflowFallback('server_active_annonces', (selectClause) =>
          supabase
            .from('annonces')
            .select(selectClause)
            .eq('serveur_id', userId)
            .in('statut', [...ACTIVE_MISSION_READ_STATUSES])
            .order('date', { ascending: true })
            .order('heure_debut', { ascending: true })
        ),
      ])

      if (engagementRowsError) {
        console.warn('server mission engagement fetch error', {
          userId,
          error: {
            message: engagementRowsError.message,
            code: (engagementRowsError as any)?.code ?? null,
            details: (engagementRowsError as any)?.details ?? null,
            hint: (engagementRowsError as any)?.hint ?? null,
          },
        })
      }

      const activeEngagementRows = ((engagementRows as any[]) ?? []).filter((row) => isActiveEngagementStatus(row?.status))
      const activeEngagementIds = activeEngagementRows.map((row: any) => String(row?.id ?? '')).filter(Boolean)
      const fallbackContractsByEngagementId =
        activeEngagementIds.length > 0 ? await fetchContractMapForEngagements(activeEngagementIds) : {}
      const engagementMissionIds = [...new Set(activeEngagementRows.map((row) => String(row?.mission_id ?? '')).filter(Boolean))]
      const directMissionIds = [...new Set(((confirmedAnnonces as any[]) ?? []).map((row) => String(row?.id ?? '')).filter(Boolean))]
      const missingMissionIds = engagementMissionIds.filter((missionId) => !directMissionIds.includes(missionId))

      const engagementAnnonceRows = missingMissionIds.length > 0
        ? await fetchAnnoncesWithWorkflowFallback('server_engagement_missing_annonces', (selectClause) =>
            supabase
              .from('annonces')
              .select(selectClause)
              .in('id', missingMissionIds)
          )
        : []

      const engagementByMissionId = new Map(
        activeEngagementRows.map((row: any) => [String(row.mission_id), row])
      )
      const fallbackMissionRestaurantNames = new Map<string, string>()
      const contractFallbackRows = missingMissionIds
        .map((missionId) => {
          const engagement = engagementByMissionId.get(String(missionId))
          const contract = engagement ? fallbackContractsByEngagementId[String(engagement.id)] ?? null : null
          const mission = contract?.payload_snapshot?.mission
          if (!engagement || !contract || !mission?.id) return null

          const fallbackRestaurantName =
            contract.payload_snapshot?.etablissement?.nom ??
            contract.payload_snapshot?.patron?.nom_restaurant ??
            null

          if (fallbackRestaurantName) {
            fallbackMissionRestaurantNames.set(String(mission.id), fallbackRestaurantName)
          }

          return {
            id: String(mission.id),
            poste: mission.poste ?? '',
            date: mission.date ?? '',
            heure_debut: mission.heure_debut ?? '',
            heure_fin: mission.heure_fin ?? '',
            mission_slot: mission.mission_slot ?? null,
            salaire: mission.salaire_brut_horaire ?? 0,
            ville: mission.ville ?? '',
            statut: normalizeEngagementStatus(engagement.status) === 'active' ? 'in_progress' : 'confirmed',
            serveur_id: String(engagement.serveur_id ?? userId),
            patron_id: String(engagement.patron_id ?? contract.patron_id ?? ''),
            etablissement_id: contract.etablissement_id ?? null,
            description: mission.description ?? null,
            lat: contract.payload_snapshot?.etablissement?.lat ?? null,
            lng: contract.payload_snapshot?.etablissement?.lng ?? null,
            note: null,
            created_at: contract.created_at ?? engagement.created_at ?? null,
            presence_confirmation_status: null,
            contract_status: null,
            payment_status: null,
            check_in_status: engagement.checked_out_at
              ? 'checked_out'
              : engagement.checked_in_at
                ? 'checked_in'
                : 'not_checked_in',
            dpae_done: null,
            dpae_status: null,
            dpae_done_at: null,
            dpae_done_by: null,
            dpae_payload_snapshot: null,
            check_out_requested_by: null,
            check_out_requested_at: null,
            check_out_confirmed_at: null,
            checked_in_at: engagement.checked_in_at ?? null,
            checked_out_at: engagement.checked_out_at ?? null,
          }
        })
        .filter(Boolean) as any[]
      const mergedAnnonceRows = dedupeAnnoncesById([
        ...((confirmedAnnonces as any[]) ?? []),
        ...((engagementAnnonceRows as any[]) ?? []),
        ...contractFallbackRows,
      ])
      const normalizedConfirmedAnnonces = normalizeAnnonceRecords(mergedAnnonceRows as any[])
      const progressedIds = normalizedConfirmedAnnonces.length > 0 ? await syncAnnoncesInProgress(normalizedConfirmedAnnonces as any[]) : []
      const normalized = normalizedConfirmedAnnonces
        .map((a: any) => {
          const engagement = engagementByMissionId.get(String(a.id))
          const forcedSelectionStatus =
            engagement && !isActiveMissionStatus(a.statut) && !hasMissionEnded(a.date, a.heure_debut, a.heure_fin)
              ? 'confirmed'
              : a.statut
          return progressedIds.includes(String(a.id))
            ? { ...a, statut: 'in_progress' }
            : { ...a, statut: forcedSelectionStatus }
        })
        .filter((a: any) => a?.patron_id && !hasMissionEnded(a.date, a.heure_debut, a.heure_fin))

      console.log('server selected mission debug', activeEngagementRows.map((row: any) => {
        const missionId = String(row?.mission_id ?? '')
        const matchedAnnonce = normalizedConfirmedAnnonces.find((annonce: any) => String(annonce.id) === missionId) ?? null
        const visibleMission = normalized.find((mission: any) => String(mission.id) === missionId) ?? null
        const engagementContract = fallbackContractsByEngagementId[String(row?.id ?? '')] ?? null
        return {
          mission_id: missionId,
          server_id: String(row?.serveur_id ?? ''),
          engagement_status: row?.status ?? null,
          annonce_status: matchedAnnonce?.statut ?? null,
          exists_in_base: Boolean(matchedAnnonce),
          contract_id: engagementContract?.id ?? null,
          fallback_from_contract: Boolean(engagementContract && contractFallbackRows.some((mission) => String(mission.id) === missionId)),
          fetched_on_server: Boolean(visibleMission),
          category: visibleMission ? 'missions_actives' : 'not_visible',
        }
      }))

      if (normalized.length > 0) {
        const { data: dpaeRows, error: dpaeError } = await supabase.from('dpae_records').select('mission_id, status').in('mission_id', normalized.map((a: any) => String(a.id)))
        const dpaeMap: Record<string, boolean | null> = {}
        const dpaeStatusMap: Record<string, string | null> = {}
        if (!dpaeError) {
          ;(dpaeRows ?? []).forEach((row: any) => {
            const missionId = String(row.mission_id)
            dpaeMap[missionId] = row.status === 'confirmed'
            dpaeStatusMap[missionId] = row.status ?? 'not_started'
          })
        }
        const engagementMap = await fetchEngagementMapForMissions(normalized.map((a: any) => String(a.id)))
        setContracts(await fetchContractMapForEngagements(Object.values(engagementMap).map((engagement) => engagement.id)))
        const patronIds = [...new Set(normalized.map((a: any) => a.patron_id))]
        const etablissementIds = [...new Set(normalized.map((a: any) => a.etablissement_id).filter(Boolean))]
        const { data: patronsData } = await supabase.from('patrons').select('id, nom_restaurant, photo_url').in('id', patronIds)
        const etablissementMap = etablissementIds.length > 0 ? await fetchEtablissementNameMapByIds(etablissementIds as string[]) : {}
        const patronMap: Record<string, string> = {}
        const patronPhotoMap: Record<string, string | null> = {}
        ;(patronsData ?? []).forEach((p: any) => { patronMap[String(p.id)] = p.nom_restaurant ?? 'Restaurant'; patronPhotoMap[String(p.id)] = p.photo_url ?? null })
        setMissionsActives(normalized.map((a: any) => ({ id: a.id, poste: a.poste, etablissement_id: a.etablissement_id, ville: a.ville, date: a.date, heure_debut: a.heure_debut, heure_fin: a.heure_fin, salaire: a.salaire, statut: a.statut, presence_confirmation_status: a.presence_confirmation_status ?? null, contract_status: a.contract_status ?? null, payment_status: a.payment_status ?? null, check_in_status: a.check_in_status ?? null, dpae_done: Object.prototype.hasOwnProperty.call(dpaeMap, String(a.id)) ? dpaeMap[String(a.id)] : false, dpae_status: Object.prototype.hasOwnProperty.call(dpaeStatusMap, String(a.id)) ? dpaeStatusMap[String(a.id)] : 'not_started', checked_in_at: a.checked_in_at ?? null, checked_out_at: a.checked_out_at ?? null, check_out_requested_by: a.check_out_requested_by ?? null, check_out_requested_at: a.check_out_requested_at ?? null, check_out_confirmed_at: a.check_out_confirmed_at ?? null, engagement_status: engagementMap[String(a.id)]?.status ?? null, nom_restaurant: (a.etablissement_id ? etablissementMap[String(a.etablissement_id)] : null) ?? patronMap[String(a.patron_id)] ?? fallbackMissionRestaurantNames.get(String(a.id)) ?? 'Restaurant', patron_photo_url: patronPhotoMap[String(a.patron_id)] ?? null })))
      } else { setMissionsActives([]); setContracts({}) }

      const completedAnnonces = await fetchAnnoncesWithWorkflowFallback('server_completed_annonces', (selectClause) =>
        supabase
          .from('annonces')
          .select(selectClause)
          .eq('serveur_id', userId)
          .in('statut', [...COMPLETED_MISSION_READ_STATUSES])
          .order('date', { ascending: false })
          .order('heure_debut', { ascending: false })
      )
      const normalizedCompletedAnnonces = normalizeAnnonceRecords(completedAnnonces as any[])
      if (normalizedCompletedAnnonces.length > 0) {
        const patronIds = [...new Set(normalizedCompletedAnnonces.map((a: any) => a.patron_id))]
        const etablissementIds = [...new Set(normalizedCompletedAnnonces.map((a: any) => a.etablissement_id).filter(Boolean))]
        const { data: patronsData } = await supabase.from('patrons').select('id, nom_restaurant, photo_url').in('id', patronIds)
        const etablissementMap = etablissementIds.length > 0 ? await fetchEtablissementNameMapByIds(etablissementIds as string[]) : {}
        const patronMap: Record<string, string> = {}
        const patronPhotoMap: Record<string, string | null> = {}
        ;(patronsData ?? []).forEach((p: any) => { patronMap[String(p.id)] = p.nom_restaurant ?? 'Restaurant'; patronPhotoMap[String(p.id)] = p.photo_url ?? null })
        setMissionsTerminees(normalizedCompletedAnnonces.map((a: any) => ({
          id: a.id,
          poste: a.poste,
          etablissement_id: a.etablissement_id,
          ville: a.ville,
          date: a.date,
          heure_debut: a.heure_debut,
          heure_fin: a.heure_fin,
          salaire: a.salaire,
          statut: a.statut,
          nom_restaurant: (a.etablissement_id ? etablissementMap[String(a.etablissement_id)] : null) ?? patronMap[String(a.patron_id)] ?? 'Restaurant',
          patron_photo_url: patronPhotoMap[String(a.patron_id)] ?? null,
        })))
      } else {
        setMissionsTerminees([])
      }

      const { data: demandes } = await supabase
        .from('demandes')
        .select('id, annonce_id, statut')
        .eq('serveur_id', userId)
        .eq('initiateur', 'patron')
        .in('statut', ['en_attente', 'acceptee'])

      if ((demandes?.length ?? 0) > 0) {
        const safeDemandes = demandes ?? []
        const annoncesData = await fetchAnnoncesWithWorkflowFallback('server_patron_demandes_annonces', (selectClause) =>
          supabase
            .from('annonces')
            .select(selectClause)
            .in('id', safeDemandes.map((d: any) => d.annonce_id))
        )
        const normalizedDemandAnnonces = normalizeAnnonceRecords(annoncesData as any[])
        const expiredIds = normalizedDemandAnnonces
          .filter((a: any) => shouldHideMissionFromOpenLists(a.statut, a.date, a.heure_debut, a.heure_fin))
          .map((a: any) => a.id)
        if (expiredIds.length > 0) await expireOpenAnnonces(expiredIds)
        if (normalizedDemandAnnonces.length > 0) {
          const patronIds = [...new Set(normalizedDemandAnnonces.map((a: any) => a.patron_id))]
          const etablissementIds = [...new Set(normalizedDemandAnnonces.map((a: any) => a.etablissement_id).filter(Boolean))]
          const { data: patronsData } = await supabase.from('patrons').select('id, nom_restaurant, photo_url').in('id', patronIds)
          const etablissementMap = etablissementIds.length > 0 ? await fetchEtablissementNameMapByIds(etablissementIds as string[]) : {}
          const patronMap: Record<string, string> = {}
          const patronPhotoMap: Record<string, string | null> = {}
          ;(patronsData ?? []).forEach((p: any) => { patronMap[p.id] = p.nom_restaurant; patronPhotoMap[p.id] = p.photo_url ?? null })
          const annonceMap: Record<string, any> = {}; normalizedDemandAnnonces.forEach((a: any) => { annonceMap[a.id] = a })
          const activeMissionIds = new Set(normalized.map((mission: any) => String(mission.id)))
          const validDemandes = safeDemandes.filter((d: any) => {
            const a = annonceMap[d.annonce_id]
            return Boolean(a && !shouldHideMissionFromOpenLists(a.statut, a.date, a.heure_debut, a.heure_fin) && a.poste && a.ville && a.date && a.heure_debut && a.heure_fin && a.salaire != null)
          })

          const nextOffresRecues = validDemandes
            .filter((d: any) => d.statut === 'en_attente' && isOpenMissionStatus(annonceMap[d.annonce_id]?.statut))
            .map((d: any) => {
              const a = annonceMap[d.annonce_id]
              return {
                demande_id: d.id,
                annonce_id: d.annonce_id,
                poste: a.poste,
                etablissement_id: a.etablissement_id,
                ville: a.ville,
                date: a.date,
                heure_debut: a.heure_debut,
                heure_fin: a.heure_fin,
                salaire: a.salaire,
                nom_restaurant: (a.etablissement_id ? etablissementMap[a.etablissement_id] : null) ?? patronMap[a.patron_id] ?? 'Restaurant',
                description: a.description ?? null,
                patron_photo_url: patronPhotoMap[a.patron_id] ?? null,
              }
            })
          setOffresRecues(nextOffresRecues)

          const eligibilityEntries = await Promise.all(
            nextOffresRecues.map(async (offre) => {
              const eligibility = await getMissionRateNegotiationEligibility(userId, offre.annonce_id)
              return [offre.annonce_id, eligibility.allowed ? eligibility : null] as const
            })
          )
          setProposalNegotiationEligibility(Object.fromEntries(eligibilityEntries))

          setMissionsEnAttente(validDemandes
            .filter((d: any) => d.statut === 'acceptee')
            .filter((d: any) => !activeMissionIds.has(String(d.annonce_id)))
            .filter((d: any) => {
              const missionStatus = normalizeMissionStatus(annonceMap[d.annonce_id]?.statut)
              return !['completed', 'cancelled_by_patron', 'cancelled_by_server', 'expired', 'no_show'].includes(missionStatus)
            })
            .map((d: any) => {
              const a = annonceMap[d.annonce_id]
              const pendingStatus = getPendingServerMissionStatus(a.statut)
              return {
                demande_id: d.id,
                annonce_id: d.annonce_id,
                poste: a.poste,
                etablissement_id: a.etablissement_id,
                ville: a.ville,
                date: a.date,
                heure_debut: a.heure_debut,
                heure_fin: a.heure_fin,
                salaire: a.salaire,
                statut: a.statut,
                nom_restaurant: (a.etablissement_id ? etablissementMap[a.etablissement_id] : null) ?? patronMap[a.patron_id] ?? 'Restaurant',
                patron_photo_url: patronPhotoMap[a.patron_id] ?? null,
                status_label: pendingStatus.label,
                status_hint: pendingStatus.hint,
              }
            }))

          console.log('server missions visibility buckets', {
            userId,
            offresRecuesCount: validDemandes.filter((d: any) => d.statut === 'en_attente' && isOpenMissionStatus(annonceMap[d.annonce_id]?.statut)).length,
            missionsEnAttenteCount: validDemandes.filter((d: any) => d.statut === 'acceptee' && !activeMissionIds.has(String(d.annonce_id))).length,
            missionsActivesCount: normalized.length,
            activeMissionIds: [...activeMissionIds],
          })
        } else {
          setOffresRecues([])
          setMissionsEnAttente([])
          setProposalNegotiationEligibility({})
        }
      } else {
        setOffresRecues([])
        setMissionsEnAttente([])
        setProposalNegotiationEligibility({})
      }
    } catch (e) {
      console.error('dashboard fetchData error:', e)
    }
  }, [router])

  useEffect(() => { let mounted = true; (async () => { try { await fetchData() } finally { if (mounted) setLoading(false) } })(); return () => { mounted = false } }, [fetchData])
  useFocusEffect(useCallback(() => { fetchData() }, [fetchData]))
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false) }, [fetchData])

  const refreshAfterAcceptance = useCallback(async () => {
    await fetchData()

    setTimeout(() => {
      fetchData()
    }, 600)
  }, [fetchData])

  const accepterOffre = async (annonceId: string) => {
    Alert.alert('Confirmer', 'Confirmer votre disponibilité pour cette mission ?', [{
      text: 'Annuler',
      style: 'cancel',
    }, {
      text: 'Confirmer ma disponibilité',
      onPress: async () => {
        console.log('confirm availability click', { annonceId })

        const { data: authData } = await supabase.auth.getUser()
        const authUser = authData.user
        const userId = authUser?.id ?? await getCurrentUserId()
        if (!userId) {
          console.warn('confirm availability auth missing')
          Alert.alert('Erreur', 'Utilisateur introuvable.')
          return
        }

        const [roleDetected, serveurLookup, demandeLookup, annonceLookup] = await Promise.all([
          resolveAccountRole(userId, authUser?.user_metadata?.account_role),
          supabase.from('serveurs').select('id, prenom, nom').eq('id', userId).maybeSingle(),
          supabase
            .from('demandes')
            .select('id, annonce_id, serveur_id, statut, initiateur')
            .eq('annonce_id', annonceId)
            .eq('serveur_id', userId)
            .eq('initiateur', 'patron')
            .maybeSingle(),
          supabase
            .from('annonces')
            .select('id, statut, serveur_id, patron_id')
            .eq('id', annonceId)
            .maybeSingle(),
        ])

        console.log('confirm availability validation start', {
          authUid: userId,
          missionId: annonceId,
          roleDetected,
          roleMetadata: authUser?.user_metadata?.account_role ?? null,
          serveurRowFound: Boolean(serveurLookup.data?.id),
          serveurRowError: serveurLookup.error ? {
            message: serveurLookup.error.message,
            code: (serveurLookup.error as any)?.code ?? null,
            details: (serveurLookup.error as any)?.details ?? null,
            hint: (serveurLookup.error as any)?.hint ?? null,
          } : null,
          demande: demandeLookup.data ? {
            id: demandeLookup.data.id,
            annonce_id: demandeLookup.data.annonce_id,
            serveur_id: demandeLookup.data.serveur_id,
            statut: demandeLookup.data.statut,
            initiateur: demandeLookup.data.initiateur,
          } : null,
          demandeError: demandeLookup.error ? {
            message: demandeLookup.error.message,
            code: (demandeLookup.error as any)?.code ?? null,
            details: (demandeLookup.error as any)?.details ?? null,
            hint: (demandeLookup.error as any)?.hint ?? null,
          } : null,
          annonce: annonceLookup.data ? {
            id: annonceLookup.data.id,
            statut: annonceLookup.data.statut,
            serveur_id: annonceLookup.data.serveur_id,
            patron_id: annonceLookup.data.patron_id,
          } : null,
          annonceError: annonceLookup.error ? {
            message: annonceLookup.error.message,
            code: (annonceLookup.error as any)?.code ?? null,
            details: (annonceLookup.error as any)?.details ?? null,
            hint: (annonceLookup.error as any)?.hint ?? null,
          } : null,
        })

        const result = await selectServeurForMission(annonceId, userId)

        console.log('confirm availability result', {
          authUid: userId,
          missionId: annonceId,
          demandeId: demandeLookup.data?.id ?? null,
          result,
        })

        if (!result.ok) {
          const targetOffre = offresRecues.find((offre) => offre.annonce_id === annonceId) ?? null
          const busyMessage = targetOffre
            ? getServerBusySlotMessage(detectMissionSlot(targetOffre.heure_debut, targetOffre.heure_fin), 'self')
            : getServerBusySlotMessage(null, 'self')
          const fallbackMessage =
            result.reason === 'already_assigned'
              ? 'Cette mission a déjà été pourvue.'
              : result.reason === 'worker_unavailable'
                ? busyMessage
                : 'Impossible de confirmer votre disponibilité.'
          Alert.alert('Information', result.message ?? fallbackMessage)
          return
        }

        await refreshAfterAcceptance()
      },
    }])
  }
  const refuserOffre = async (demandeId: string) => { await supabase.from('demandes').update({ statut: 'refusee' }).eq('id', demandeId); fetchData() }
  const annulerParticipation = async (annonceId: string) => {
    Alert.alert('Confirmer', 'Annuler votre participation ?', [{ text: 'Retour', style: 'cancel' }, { text: 'Annuler', style: 'destructive', onPress: async () => { const result = await cancelConfirmedAnnonce(annonceId, 'serveur'); if (!result.ok) { Alert.alert('Erreur', "Impossible d'annuler."); return } fetchData() } }])
  }
  const demanderOuConfirmerCheckOut = async (mission: MissionActive) => {
    const validationSnapshot = buildMissionValidationSnapshot(mission, null)
    const blockMessage = getCheckOutBlockMessage(validationSnapshot)
    if (blockMessage) {
      Alert.alert('Check-out indisponible', blockMessage)
      return
    }

    const requestedByMe = Boolean(serveur?.id && mission.check_out_requested_by === serveur.id)
    if (requestedByMe) {
      Alert.alert('En attente de confirmation', 'Le check-out est déjà en attente de confirmation par l’autre partie.')
      return
    }

    const isConfirmingOtherRequest = Boolean(mission.check_out_requested_by)
    Alert.alert(
      isConfirmingOtherRequest ? 'Confirmer le check-out' : 'Demander le check-out',
      isConfirmingOtherRequest
        ? 'Confirmer le check-out demandé par l’autre partie ?'
        : 'Demander le check-out pour cette mission ?',
      [
        { text: 'Retour', style: 'cancel' },
        {
          text: isConfirmingOtherRequest ? 'Confirmer' : 'Demander',
          onPress: async () => {
            const result = await markMissionCheckOut(mission.id)
            if (!result.ok) {
              Alert.alert('Action bloquée', result.message ?? "Impossible d'enregistrer le check-out.")
              return
            }
            await fetchData()
            if (result.stage === 'pending_confirmation') {
              Alert.alert('Check-out demandé', 'Le check-out est en attente de confirmation par l’autre partie.')
              return
            }
            Alert.alert('Mission terminée', 'Le check-out a bien été confirmé.')
          },
        },
      ]
    )
  }
  const voirContrat = (missionId: string, engagementId?: string | null) => {
    router.push({
      pathname: '/contrat-engagement',
      params: {
        annonceId: missionId,
        engagementId: engagementId ?? '',
      },
    })
  }
  const postulerOpportunite = async (annonceId: string) => {
    const userId = await getCurrentUserId(); if (!userId || postulatingAnnonceId) return; setPostulatingAnnonceId(annonceId)
    try {
      const { data: existing } = await supabase.from('demandes').select('id, initiateur').eq('annonce_id', annonceId).eq('serveur_id', userId).in('statut', ['en_attente', 'acceptee']).maybeSingle()
      if (existing) { Alert.alert('Information', existing.initiateur === 'patron' ? 'Cette proposition attend déjà votre réponse.' : 'Votre intérêt est déjà enregistré.'); return }
      const { error } = await supabase.from('demandes').insert({ annonce_id: annonceId, serveur_id: userId, statut: 'en_attente', initiateur: 'serveur' })
      if (error) { Alert.alert('Erreur', "Impossible d'envoyer votre intérêt."); return }
      Alert.alert('Intérêt envoyé', "L'établissement a bien reçu votre disponibilité.")
      await fetchData()
    } finally { setPostulatingAnnonceId(null) }
  }

  const ouvrirNegociation = async (annonce: NegotiationTargetMission) => {
    const userId = await getCurrentUserId()
    if (!userId || negotiationLoading || negotiationSubmitting) return

    setNegotiationLoading(true)
    try {
      const existing = await fetchMissionNegotiationForServer(userId, annonce.id)
      if (existing) {
        const statusLabel =
          existing.status === 'pending'
            ? 'Contre-offre envoyée'
            : existing.status === 'accepted'
              ? 'Contre-offre acceptée'
              : existing.status === 'rejected'
                ? 'Contre-offre refusée'
                : 'Contre-offre déjà enregistrée'
        Alert.alert(statusLabel, `Votre proposition à ${existing.counter_rate}${EURO}/h a déjà été enregistrée.`)
        return
      }

      const eligibility = await getMissionRateNegotiationEligibility(userId, annonce.id)
      if (!eligibility.allowed) {
        Alert.alert('Négociation indisponible', eligibility.reasons[0] ?? 'Cette mission ne peut pas être négociée.')
        return
      }

      setNegotiationEligibility(eligibility)
      setNegotiationTarget({
        id: annonce.id,
        poste: annonce.poste,
        salaire: annonce.salaire,
        nom_restaurant: annonce.nom_restaurant,
      })
      setNegotiationRateInput(String(netEstime(eligibility.maxAllowedRate)))
    } finally {
      setNegotiationLoading(false)
    }
  }

  const fermerNegociation = () => {
    if (negotiationSubmitting) return
    setNegotiationTarget(null)
    setNegotiationEligibility(null)
    setNegotiationRateInput('')
  }

  const envoyerContreOffre = async () => {
    const userId = await getCurrentUserId()
    if (!userId || !negotiationTarget || !negotiationEligibility || negotiationSubmitting) return

    setNegotiationSubmitting(true)
    try {
      const askedNetRate = parseMoneyInput(negotiationRateInput)
      const askedBrutRate = brutDepuisNetEstime(askedNetRate)
      const result = await createMissionRateCounterOffer({
        missionId: negotiationTarget.id,
        serveurId: userId,
        counterRate: askedBrutRate,
      })

      if (!result.ok) {
        Alert.alert("Impossible d'envoyer la contre-offre.", result.message)
        return
      }

      setNegotiations((current) => ({
        ...current,
        [negotiationTarget.id]: result.negotiation,
      }))
      fermerNegociation()
      Alert.alert(
        'Contre-offre envoyée',
        `Votre proposition à ~${netEstime(result.negotiation.counter_rate)}${EURO}/h net a bien été transmise au patron.`
      )
      await fetchData()
    } finally {
      setNegotiationSubmitting(false)
    }
  }

  if (loading) return <View style={s.loadWrap}><StatusBar barStyle="dark-content" backgroundColor={C.bg} /><ActivityIndicator size="large" color={C.accent} /></View>
  if (!serveur) return null

  const focusParam = Array.isArray(params.focus) ? params.focus[0] : params.focus
  const activeTopCard =
    focusParam === 'upcoming'
      ? 'upcoming'
      : focusParam === 'completed'
        ? 'completed'
        : 'opportunities'
  const showUpcomingOnly = activeTopCard === 'upcoming'
  const showCompletedOnly = activeTopCard === 'completed'
  const initials = initialesAvatar(serveur.prenom ?? '', serveur.nom ?? '')
  const dispo = serveur.disponible ?? false
  const taux = tauxPresence(serveur.missions_realisees ?? 0, serveur.missions_acceptees ?? 0, serveur.missions_annulees ?? 0)
  const tone = getPresenceTone(taux)
  const nbProches = annonces?.length ?? 0
  const opportunitiesCount = nbProches + offresRecues.length
  const missionsPretes = missionsActives.filter((mission) => {
    const engagementContract = Object.values(contracts).find((item) => item.mission_id === mission.id) ?? null
    const summary = getMissionValidationSummary(buildMissionValidationSnapshot(mission, engagementContract))
    return summary.isReadyForCheckIn && summary.checkInStatus !== 'checked_in'
  })
  const missionsEnCours = missionsActives.filter((mission) => {
    const engagementContract = Object.values(contracts).find((item) => item.mission_id === mission.id) ?? null
    const summary = getMissionValidationSummary(buildMissionValidationSnapshot(mission, engagementContract))
    return summary.checkInStatus === 'checked_in' || summary.missionStatus === 'in_progress'
  })
  const missionsActivesEnAttente = missionsActives.filter((mission) => {
    const engagementContract = Object.values(contracts).find((item) => item.mission_id === mission.id) ?? null
    const summary = getMissionValidationSummary(buildMissionValidationSnapshot(mission, engagementContract))
    return !(summary.isReadyForCheckIn && summary.checkInStatus !== 'checked_in') && !(summary.checkInStatus === 'checked_in' || summary.missionStatus === 'in_progress')
  })
  const upcomingMissionCount =
    missionsEnAttente.length +
    missionsActivesEnAttente.length +
    missionsPretes.length +
    missionsEnCours.length
  const showOpportunitiesActive = activeTopCard === 'opportunities'
  const showCompletedActive = activeTopCard === 'completed'
  const showPreparingUpcoming = showUpcomingOnly
  const showReadyUpcoming = showUpcomingOnly

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}>
        <View style={s.header}>
          <View style={s.headerText}>
            <Text style={s.overline}>MISSIONS</Text>
            <Text style={s.name}>{serveur.prenom}</Text>
            <Text style={s.nameAccent}>{serveur.nom}</Text>
            <Text style={s.headerSub}>
              {showUpcomingOnly
                ? 'Retrouvez ici uniquement vos missions actives et À venir.'
                : showCompletedOnly
                  ? 'Retrouvez ici l’historique de vos missions terminées.'
                  : 'Recevez des missions, travaillez quand vous voulez.'}
            </Text>
          </View>
          <View style={s.avatar} pointerEvents="none">
            {serveur.photo_url ? (
              <Image source={{ uri: serveur.photo_url }} style={s.avatarImage} resizeMode="cover" />
            ) : (
              <Text style={s.avatarText}>{initials}</Text>
            )}
            <View style={[s.avatarDot, !dispo && s.avatarDotOff]} />
          </View>
        </View>

        <View style={s.statsRow}>
          <TouchableOpacity
            style={[s.statCard, showOpportunitiesActive ? s.statCardActive : null]}
            onPress={() => router.push('/(server-tabs)/missions')}
            activeOpacity={0.86}
          >
            {offresRecues.length > 0 ? (
              <View style={[s.statBadge, showOpportunitiesActive ? s.statBadgeActive : null]}>
                <Text style={[s.statBadgeText, showOpportunitiesActive ? s.statBadgeTextActive : null]}>
                  {offresRecues.length}
                </Text>
              </View>
            ) : null}
            <Text style={[s.statNum, { color: C.accent }, showOpportunitiesActive ? s.statNumActive : null]}>{opportunitiesCount}</Text>
            <Text style={[s.statLbl, showOpportunitiesActive ? s.statLblActive : null]}>Opportunités</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.statCard, showUpcomingOnly ? s.statCardActive : null]} onPress={() => router.push({ pathname: '/(server-tabs)/missions', params: { focus: 'upcoming' } })} activeOpacity={0.86}>
            <Text style={[s.statNum, { color: C.accent }, showUpcomingOnly ? s.statNumActive : null]}>{upcomingMissionCount}</Text>
            <Text style={[s.statLbl, showUpcomingOnly ? s.statLblActive : null]}>À venir</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.statCard, showCompletedActive ? s.statCardActive : null]}
            onPress={() => router.push({ pathname: '/(server-tabs)/missions', params: { focus: 'completed' } })}
            activeOpacity={0.86}
          >
            <Text style={[s.statNum, { color: C.accent }, showCompletedActive ? s.statNumActive : null]}>{missionsTerminees.length}</Text>
            <Text style={[s.statLbl, showCompletedActive ? s.statLblActive : null]}>Terminées</Text>
          </TouchableOpacity>
        </View>

        {showCompletedOnly && (
          <>
            <View style={s.sectionHeader}><Text style={s.sectionTitle}>Terminées</Text></View>
            {missionsTerminees.length === 0 ? (
              <View style={s.emptyCard}>
                <Text style={s.emptyTitle}>Aucune mission terminée</Text>
                <Text style={s.emptySub}>Vos missions clôturées apparaîtront ici.</Text>
              </View>
            ) : (
              <View style={s.list}>{missionsTerminees.map((mission, i) => (
                <View key={mission.id} style={[s.cardConfirmed, i < missionsTerminees.length - 1 && s.cardMb]}>
                  <View style={s.cardTop}>
                    {renderMissionAvatar(mission.patron_photo_url, mission.nom_restaurant, posteColor(mission.poste))}
                    <View style={{ flex: 1 }}><Text style={s.cardPoste}>{mission.poste}</Text><Text style={s.cardResto}>{mission.nom_restaurant}</Text></View>
                    <View style={s.badgeConfirmed}><Text style={s.badgeConfirmedTxt}>TERMINÉE</Text></View>
                  </View>
                  <View style={s.detailList}>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Établissement</Text><Text style={s.detailValue}>{mission.nom_restaurant}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Ville</Text><Text style={s.detailValue}>{mission.ville}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Date</Text><Text style={s.detailValue}>{formatDateFr(mission.date)}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Horaires</Text><Text style={s.detailValue}>{mission.heure_debut} - {mission.heure_fin}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Tarif</Text><Text style={s.detailValueStrong}>{`~${netEstime(mission.salaire)}${EURO} / h net`}</Text></View>
                  </View>
                </View>
              ))}</View>
            )}
          </>
        )}

        {showOpportunitiesActive && (
          <>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Accès rapides</Text>
            </View>
            <View style={s.quickAccessRow}>
              <TouchableOpacity style={s.quickAccessCard} onPress={() => router.push('/mes-candidatures-serveur')} activeOpacity={0.86}>
                <Text style={s.quickAccessEyebrow}>Suivi</Text>
                <Text style={s.quickAccessTitle}>Mes candidatures</Text>
                <Text style={s.quickAccessMeta}>{mesCandidatures.length} active{mesCandidatures.length > 1 ? 's' : ''}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {showOpportunitiesActive && offresRecues.length > 0 && <>
          <View style={s.sectionHeader}><Text style={s.sectionTitle}>Missions proposées</Text></View>
          <View style={s.list}>{offresRecues.map((offre, i) => (
            <View key={offre.demande_id} style={[s.card, i < offresRecues.length - 1 && s.cardMb]}>
              {(() => {
                const negotiationEligibility = proposalNegotiationEligibility[offre.annonce_id]
                const negotiationCtaLabel = getNegotiationButtonLabel(negotiationEligibility)
                const negotiationDisabledReason = getNegotiationDisabledReason(negotiationEligibility)
                const negotiationDisabled = !negotiationEligibility?.allowed
                return (
                  <>
              <View style={s.cardTop}>
                {renderMissionAvatar(offre.patron_photo_url, offre.nom_restaurant, posteColor(offre.poste))}
                <View style={{ flex: 1 }}><Text style={s.cardPoste}>{offre.poste}</Text><Text style={s.cardResto}>{offre.nom_restaurant}</Text></View>
                <View style={s.badge}><Text style={s.badgeTxt}>{getWorkerInterestLabel({ statut: 'en_attente', initiateur: 'patron' }).toUpperCase()}</Text></View>
              </View>
              <View style={s.detailList}>
                <View style={s.detailRow}><Text style={s.detailLabel}>Établissement</Text><Text style={s.detailValue}>{offre.nom_restaurant}</Text></View>
                <View style={s.detailRow}><Text style={s.detailLabel}>Ville</Text><Text style={s.detailValue}>{offre.ville}</Text></View>
                <View style={s.detailRow}><Text style={s.detailLabel}>Date</Text><Text style={s.detailValue}>{formatDateFr(offre.date)}</Text></View>
                <View style={s.detailRow}><Text style={s.detailLabel}>Horaires</Text><Text style={s.detailValue}>{offre.heure_debut} - {offre.heure_fin}</Text></View>
                <View style={s.detailRow}><Text style={s.detailLabel}>Tarif</Text><Text style={s.detailValueStrong}>{`~${netEstime(offre.salaire)}${EURO} / h net`}</Text></View>
              </View>
              {offre.description ? (
                <View style={s.infoBox}>
                  <Text style={s.infoText}>{offre.description}</Text>
                </View>
              ) : null}
              <View style={s.actions}>
                <TouchableOpacity style={[s.btn, s.btnAccept]} onPress={() => accepterOffre(offre.annonce_id)} activeOpacity={0.85}><Text style={s.btnAcceptTxt}>Confirmer ma disponibilité</Text></TouchableOpacity>
                <TouchableOpacity style={[s.btn, s.btnRefus]} onPress={() => refuserOffre(offre.demande_id)} activeOpacity={0.85}><Text style={s.btnRefusTxt}>Refuser</Text></TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[s.btn, s.btnGhost, s.btnGhostFull, negotiationDisabled ? s.btnDisabled : null]}
                onPress={() => ouvrirNegociation({ id: offre.annonce_id, poste: offre.poste, salaire: offre.salaire, nom_restaurant: offre.nom_restaurant })}
                activeOpacity={0.85}
                disabled={negotiationDisabled}
              >
                <Text style={s.footerBtnGhostTxt}>{negotiationCtaLabel}</Text>
              </TouchableOpacity>
              {negotiationDisabledReason ? <Text style={s.negotiationDisabledText}>{negotiationDisabledReason}</Text> : null}
                  </>
                )
              })()}
            </View>
          ))}</View>
        </>}

        {showPreparingUpcoming && missionsEnAttente.length > 0 && <>
          <View style={s.sectionHeader}><Text style={s.sectionTitle}>{missionsEnAttente.length > 1 ? 'Missions en attente' : 'Mission en attente'}</Text></View>
          <View style={s.list}>{missionsEnAttente.map((mission, i) => (
            <View key={mission.demande_id} style={[s.cardConfirmed, i < missionsEnAttente.length - 1 && s.cardMb]}>
              <View style={s.cardTop}>
                {renderMissionAvatar(mission.patron_photo_url, mission.nom_restaurant, posteColor(mission.poste))}
                <View style={{ flex: 1 }}><Text style={s.cardPoste}>{mission.poste}</Text><Text style={s.cardResto}>{mission.nom_restaurant}</Text></View>
                <View style={s.badgeConfirmed}><Text style={s.badgeConfirmedTxt}>{mission.status_label.toUpperCase()}</Text></View>
              </View>
              <View style={s.detailList}>
                <View style={s.detailRow}><Text style={s.detailLabel}>Établissement</Text><Text style={s.detailValue}>{mission.nom_restaurant}</Text></View>
                <View style={s.detailRow}><Text style={s.detailLabel}>Ville</Text><Text style={s.detailValue}>{mission.ville}</Text></View>
                <View style={s.detailRow}><Text style={s.detailLabel}>Date</Text><Text style={s.detailValue}>{formatDateFr(mission.date)}</Text></View>
                <View style={s.detailRow}><Text style={s.detailLabel}>Horaires</Text><Text style={s.detailValue}>{mission.heure_debut} - {mission.heure_fin}</Text></View>
                <View style={s.detailRow}><Text style={s.detailLabel}>Tarif</Text><Text style={s.detailValueStrong}>{`~${netEstime(mission.salaire)}${EURO} / h net`}</Text></View>
              </View>
              <View style={s.infoBox}>
                <Text style={s.infoText}>{mission.status_hint}</Text>
              </View>
            </View>
          ))}</View>
        </>}

        {showPreparingUpcoming && missionsActivesEnAttente.length > 0 && <>
          <View style={s.sectionHeader}><Text style={s.sectionTitle}>En attente</Text></View>
          <View style={s.list}>{missionsActivesEnAttente.map((mission, i) => (
            <View key={mission.id} style={[s.cardConfirmed, i < missionsActivesEnAttente.length - 1 && s.cardMb]}>
              {(() => {
                const engagementContract = Object.values(contracts).find((item) => item.mission_id === mission.id) ?? null
                const validationSnapshot = buildMissionValidationSnapshot(mission, engagementContract)
                const missionSummary = getMissionValidationSummary(validationSnapshot)
                const dpaeTone = missionSummary.dpaeDone
                  ? { bg: C.accentSoft, border: C.accentSoftBorder, text: C.accent }
                  : { bg: C.terraBg, border: C.terraBd, text: C.terra }
                const pendingStatusLabel = 'CONFIRMÉE'
                const dpaeLabel = missionSummary.dpaeDone ? 'URSSAF confirmée' : 'URSSAF à finaliser'
                const checklistItems = [
                  {
                    label: 'Contrat employeur',
                    done: !missionSummary.checkInBlockers.includes('contract_patron_signature_missing'),
                  },
                  {
                    label: 'Contrat serveur',
                    done: !missionSummary.checkInBlockers.includes('contract_worker_signature_missing'),
                  },
                  {
                    label: 'DPAE confirmée',
                    done: !missionSummary.checkInBlockers.includes('dpae_not_confirmed'),
                  },
                  {
                    label: 'Prête au démarrage',
                    done: missionSummary.isReadyForCheckIn,
                  },
                ]
                const infoMessages = [
                  ...getContractWarnings(engagementContract, null),
                  getCheckInBlockMessage(validationSnapshot),
                  getCheckOutBlockMessage(validationSnapshot),
                ].filter(Boolean) as string[]
                return (
                  <>
              <View style={s.cardTop}>
                {renderMissionAvatar(mission.patron_photo_url, mission.nom_restaurant, posteColor(mission.poste))}
                <View style={{ flex: 1 }}><Text style={s.cardPoste}>{mission.poste}</Text><Text style={s.cardResto}>{mission.nom_restaurant}</Text></View>
                <View style={s.badgeConfirmed}><Text style={s.badgeConfirmedTxt}>{pendingStatusLabel}</Text></View>
              </View>
              <View style={s.detailList}>
                <View style={s.detailRow}><Text style={s.detailLabel}>Établissement</Text><Text style={s.detailValue}>{mission.nom_restaurant}</Text></View>
                <View style={s.detailRow}><Text style={s.detailLabel}>Ville</Text><Text style={s.detailValue}>{mission.ville}</Text></View>
                <View style={s.detailRow}><Text style={s.detailLabel}>Date</Text><Text style={s.detailValue}>{formatDateFr(mission.date)}</Text></View>
                <View style={s.detailRow}><Text style={s.detailLabel}>Horaires</Text><Text style={s.detailValue}>{mission.heure_debut} - {mission.heure_fin}</Text></View>
                <View style={s.detailRow}><Text style={s.detailLabel}>Contrat</Text><Text style={s.detailValue}>{missionSummary.contractDisplayLabel}</Text></View>
              </View>
              <View style={[s.statusStrip, { backgroundColor: dpaeTone.bg, borderColor: dpaeTone.border }]}>
                <Text style={s.statusStripLabel}>URSSAF</Text>
                <Text style={[s.statusStripValue, { color: dpaeTone.text }]}>{dpaeLabel}</Text>
              </View>
              <View style={s.checklistCard}>
                {checklistItems.map((item) => (
                  <View key={`${mission.id}-${item.label}`} style={s.checklistRow}>
                    <Text style={[s.checklistDot, item.done ? s.checklistDotDone : s.checklistDotTodo]}>
                      {item.done ? 'Fait' : 'À faire'}
                    </Text>
                    <Text style={[s.checklistText, item.done ? s.checklistTextDone : null]}>{item.label}</Text>
                  </View>
                ))}
              </View>
              <View style={s.salaireRow}><Text style={s.salaire}>{`~${netEstime(mission.salaire)}${EURO}`}</Text><Text style={s.salaireLbl}> / h net est.</Text></View>
              {engagementContract?.payload_snapshot?.mission?.salaire_brut_horaire != null &&
              engagementContract.payload_snapshot.mission.salaire_brut_horaire !== mission.salaire ? (
                <Text style={s.negotiationHint}>
                  Tarif retenu : {engagementContract.payload_snapshot.mission.salaire_brut_horaire}{EURO}/h brut
                </Text>
              ) : null}
              {infoMessages.length > 0 ? <View style={s.infoBox}>{infoMessages.map((message) => <Text key={`${mission.id}-${message}`} style={s.infoText}>{message}</Text>)}</View> : null}
              <TouchableOpacity style={[s.btn, s.btnGhost, s.btnGhostFull]} onPress={() => voirContrat(mission.id, engagementContract?.engagement_id ?? null)} activeOpacity={0.85}><Text style={s.footerBtnGhostTxt}>{missionSummary.contractDisplayLabel === 'À signer' ? 'Signer le contrat' : engagementContract?.status === 'signed' ? 'Voir le contrat' : 'Voir le contrat'}</Text></TouchableOpacity>
              <TouchableOpacity style={[s.btn, s.btnGhost, s.btnGhostFull]} onPress={() => annulerParticipation(mission.id)} activeOpacity={0.85}><Text style={s.btnRefusTxt}>Annuler ma participation</Text></TouchableOpacity>
                  </>
                )
              })()}
            </View>
          ))}</View>
        </>}

        {showReadyUpcoming && missionsPretes.length > 0 && <>
          <View style={s.sectionHeader}><Text style={s.sectionTitle}>{missionsPretes.length > 1 ? 'Missions confirmées' : 'Mission confirmée'}</Text><View style={s.sectionBadge}><Text style={s.sectionBadgeTxt}>{missionsPretes.length}</Text></View></View>
          <View style={s.list}>{missionsPretes.map((mission, i) => (
            <View key={mission.id} style={[s.cardConfirmed, i < missionsPretes.length - 1 && s.cardMb]}>
              {(() => {
                const engagementContract = Object.values(contracts).find((item) => item.mission_id === mission.id) ?? null
                const missionSummary = getMissionValidationSummary(buildMissionValidationSnapshot(mission, engagementContract))
                return (
                  <>
                    <View style={s.cardTop}>
                      {renderMissionAvatar(mission.patron_photo_url, mission.nom_restaurant, posteColor(mission.poste))}
                      <View style={{ flex: 1 }}><Text style={s.cardPoste}>{mission.poste}</Text><Text style={s.cardResto}>{mission.nom_restaurant}</Text></View>
                      <View style={s.badgeConfirmed}><Text style={s.badgeConfirmedTxt}>CONFIRMÉE</Text></View>
                    </View>
                    <View style={s.detailList}>
                      <View style={s.detailRow}><Text style={s.detailLabel}>Établissement</Text><Text style={s.detailValue}>{mission.nom_restaurant}</Text></View>
                      <View style={s.detailRow}><Text style={s.detailLabel}>Ville</Text><Text style={s.detailValue}>{mission.ville}</Text></View>
                      <View style={s.detailRow}><Text style={s.detailLabel}>Date</Text><Text style={s.detailValue}>{formatDateFr(mission.date)}</Text></View>
                      <View style={s.detailRow}><Text style={s.detailLabel}>Horaires</Text><Text style={s.detailValue}>{mission.heure_debut} - {mission.heure_fin}</Text></View>
                      <View style={s.detailRow}><Text style={s.detailLabel}>Contrat</Text><Text style={s.detailValue}>{missionSummary.contractDisplayLabel}</Text></View>
                    </View>
                    <View style={s.infoBox}>
                      <Text style={s.infoText}>Tout est prêt. Vous pouvez effectuer votre check-in au début de mission.</Text>
                    </View>
                    <TouchableOpacity style={[s.btn, s.btnGhost, s.btnGhostFull]} onPress={() => voirContrat(mission.id, engagementContract?.engagement_id ?? null)} activeOpacity={0.85}><Text style={s.footerBtnGhostTxt}>Voir le contrat</Text></TouchableOpacity>
                  </>
                )
              })()}
            </View>
          ))}</View>
        </>}

        {showReadyUpcoming && missionsEnCours.length > 0 && <>
          <View style={s.sectionHeader}><Text style={s.sectionTitle}>En cours</Text><View style={s.sectionBadge}><Text style={s.sectionBadgeTxt}>{missionsEnCours.length}</Text></View></View>
          <View style={s.list}>{missionsEnCours.map((mission, i) => (
            <View key={mission.id} style={[s.cardConfirmed, i < missionsEnCours.length - 1 && s.cardMb]}>
              {(() => {
                const hasCheckedIn = Boolean(mission.checked_in_at)
                const hasCheckedOut = Boolean(mission.checked_out_at)
                const requestedByMe = Boolean(serveur?.id && mission.check_out_requested_by === serveur.id)
                const requestedByOther = Boolean(mission.check_out_requested_by && !requestedByMe)
                const checkOutButtonLabel = requestedByOther
                  ? 'Confirmer le check-out'
                  : requestedByMe
                    ? 'En attente de confirmation'
                    : 'Demander le check-out'
                const showCheckOutAction = hasCheckedIn && !hasCheckedOut
                return (
                  <>
                    <View style={s.cardTop}>
                      {renderMissionAvatar(mission.patron_photo_url, mission.nom_restaurant, posteColor(mission.poste))}
                      <View style={{ flex: 1 }}><Text style={s.cardPoste}>{mission.poste}</Text><Text style={s.cardResto}>{mission.nom_restaurant}</Text></View>
                      <View style={s.badgeConfirmed}><Text style={s.badgeConfirmedTxt}>EN COURS</Text></View>
                    </View>
                    <View style={s.detailList}>
                      <View style={s.detailRow}><Text style={s.detailLabel}>Établissement</Text><Text style={s.detailValue}>{mission.nom_restaurant}</Text></View>
                      <View style={s.detailRow}><Text style={s.detailLabel}>Ville</Text><Text style={s.detailValue}>{mission.ville}</Text></View>
                      <View style={s.detailRow}><Text style={s.detailLabel}>Date</Text><Text style={s.detailValue}>{formatDateFr(mission.date)}</Text></View>
                      <View style={s.detailRow}><Text style={s.detailLabel}>Horaires</Text><Text style={s.detailValue}>{mission.heure_debut} - {mission.heure_fin}</Text></View>
                      <View style={s.detailRow}><Text style={s.detailLabel}>Tarif</Text><Text style={s.detailValueStrong}>{`~${netEstime(mission.salaire)}${EURO} / h net`}</Text></View>
                    </View>
                    {showCheckOutAction ? (
                      <TouchableOpacity
                        style={[s.btn, s.btnGhost, s.btnGhostFull, requestedByMe ? s.btnDisabled : null]}
                        onPress={() => demanderOuConfirmerCheckOut(mission)}
                        activeOpacity={requestedByMe ? 1 : 0.85}
                        disabled={requestedByMe}
                      >
                        <Text style={s.footerBtnGhostTxt}>{checkOutButtonLabel}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </>
                )
              })()}
            </View>
          ))}</View>
        </>}

        {showOpportunitiesActive && (
          <>

        <View style={s.sectionHeader}><Text style={s.sectionTitle}>Opportunités autour de vous</Text><TouchableOpacity onPress={() => router.push('/missions-disponibles')}><Text style={s.sectionLink}>Tout voir</Text></TouchableOpacity></View>

        {annonces.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>Aucune mission pour l'instant</Text>
            <Text style={s.emptySub}>{dispo ? `Élargissez votre rayon au-delà de ${serveur.rayon ?? 0} km` : "Activez vos disponibilités dans l'onglet Disponibilités"}</Text>
            {!dispo && <TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/(server-tabs)/disponibilites')} activeOpacity={0.9}><Text style={s.emptyBtnTxt}>Configurer mes disponibilités</Text></TouchableOpacity>}
          </View>
        ) : (
          <View style={s.list}>{annonces.map((annonce, i) => (
            <View key={annonce.id} style={[s.missionCard, i < annonces.length - 1 && s.cardMb]}>
              {(() => {
                const negotiation = negotiations[annonce.id] ?? null
                const negotiationLabel =
                  negotiation?.status === 'pending'
                    ? `Contre-offre envoyée : ${negotiation.counter_rate}${EURO}/h`
                    : negotiation?.status === 'accepted'
                      ? `Contre-offre acceptée : ${negotiation.counter_rate}${EURO}/h`
                      : negotiation?.status === 'rejected'
                        ? `Contre-offre refusée : ${negotiation.counter_rate}${EURO}/h`
                        : null
                return negotiationLabel ? (
                  <View style={s.negotiationBanner}>
                    <Text style={s.negotiationBannerText}>{negotiationLabel}</Text>
                  </View>
                ) : null
              })()}
              <View style={s.missionRow}>
                <View style={[s.missionIcon, { backgroundColor: `${posteColor(annonce.poste)}18` }]}><Text style={[s.missionIconTxt, { color: posteColor(annonce.poste) }]}>{posteInitiale(annonce.poste)}</Text></View>
                <View style={s.missionBody}>
                  <Text style={s.missionPoste} numberOfLines={1}>{annonce.poste}</Text>
                  {annonce.nom_restaurant ? <Text style={s.missionResto}>{annonce.nom_restaurant}</Text> : null}
                  <View style={s.detailListCompact}>
                    <View style={s.detailRowCompact}><Text style={s.detailLabel}>Ville</Text><Text style={s.detailValue}>{annonce.ville} {"·"} {formatDistance(annonce.distanceKm)}</Text></View>
                    <View style={s.detailRowCompact}><Text style={s.detailLabel}>Date</Text><Text style={s.detailValue}>{formatDateFr(annonce.date)}</Text></View>
                    <View style={s.detailRowCompact}><Text style={s.detailLabel}>Horaires</Text><Text style={s.detailValue}>{annonce.heure_debut} - {annonce.heure_fin}</Text></View>
                  </View>
                </View>
                <View style={s.missionRight}><Text style={s.missionPrice}>{`~${netEstime(annonce.salaire)}${EURO}`}</Text><Text style={s.missionPriceHint}>/ h net</Text></View>
              </View>
              {expandedOpportunityId === annonce.id ? (
                <>
                  {annonce.description ? (
                    <View style={s.infoBox}>
                      <Text style={s.infoText}>{annonce.description}</Text>
                    </View>
                  ) : null}
                  {(() => {
                    const negotiationEligibility = opportunityNegotiationEligibility[annonce.id]
                    const negotiationCtaLabel = getNegotiationButtonLabel(negotiationEligibility)
                    const negotiationDisabledReason = getNegotiationDisabledReason(negotiationEligibility)
                    const negotiationDisabled = !negotiationEligibility?.allowed
                    return (
                      <>
                        <View style={s.missionFooter}>
                          <TouchableOpacity style={[s.footerBtn, s.footerBtnGhost]} onPress={() => setExpandedOpportunityId(null)} activeOpacity={0.85}><Text style={s.footerBtnGhostTxt}>Fermer</Text></TouchableOpacity>
                          <TouchableOpacity
                            style={[s.footerBtn, s.footerBtnGhost, negotiationDisabled ? s.footerBtnDisabled : null]}
                            onPress={() => ouvrirNegociation(annonce)}
                            activeOpacity={0.85}
                            disabled={negotiationDisabled}
                          >
                            <Text style={s.footerBtnGhostTxt}>{negotiationCtaLabel}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[s.footerBtn, s.footerBtnPrimary, (postulatingAnnonceId === annonce.id || Boolean(negotiations[annonce.id])) && s.footerBtnDisabled]} disabled={postulatingAnnonceId === annonce.id || Boolean(negotiations[annonce.id])} onPress={() => postulerOpportunite(annonce.id)} activeOpacity={0.85}><Text style={s.footerBtnPrimaryTxt}>{negotiations[annonce.id] ? 'Intérêt déjà envoyé' : postulatingAnnonceId === annonce.id ? 'Envoi...' : 'Je suis intéressé'}</Text></TouchableOpacity>
                        </View>
                        {negotiationDisabledReason ? <Text style={s.negotiationDisabledText}>{negotiationDisabledReason}</Text> : null}
                      </>
                    )
                  })()}
                </>
              ) : (
                <TouchableOpacity style={[s.footerBtn, s.footerBtnGhost, s.footerBtnSingle]} onPress={() => setExpandedOpportunityId(annonce.id)} activeOpacity={0.85}><Text style={s.footerBtnGhostTxt}>Voir</Text></TouchableOpacity>
              )}
            </View>
          ))}</View>
        )}

        <View style={s.sectionHeader}><Text style={s.sectionTitle}>Votre activité</Text></View>
        <View style={s.perfGrid}>
          <View style={s.perfMain}>
            <Text style={s.perfEyebrow}>Fiabilité</Text>
            <Text style={s.perfBig}>{taux}%</Text>
            <View style={[s.perfBadge, { backgroundColor: tone.bg, borderColor: tone.border }]}><Text style={[s.perfBadgeTxt, { color: tone.text }]}>{tauxLabel(taux)}</Text></View>
            <View style={s.progressTrack}><View style={[s.progressFill, { width: `${taux}%` as any }]} /></View>
          </View>
          <View style={s.perfSide}>
            <View style={s.perfSmall}><Text style={s.perfSmallIcon}>{"⭐"}</Text><Text style={s.perfSmallVal}>{serveur.score != null ? serveur.score.toFixed(1) : '-'}</Text><Text style={s.perfSmallLbl}>Note</Text></View>
            <View style={[s.perfSmall, s.perfSmallSpacing]}><Text style={s.perfSmallIcon}>{"💼"}</Text><Text style={s.perfSmallVal}>{serveur.missions_realisees ?? 0}</Text><Text style={s.perfSmallLbl}>Réalisées</Text></View>
          </View>
        </View>
          </>
        )}
      </ScrollView>

      <Modal visible={Boolean(negotiationTarget && negotiationEligibility)} transparent animationType="slide" onRequestClose={fermerNegociation}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={fermerNegociation} />
        <View style={s.modalSheet}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>Proposer un tarif</Text>
          <Text style={s.modalSub}>
            {negotiationTarget?.poste} - {negotiationTarget?.nom_restaurant}
          </Text>
          <View style={s.modalInfoCard}>
              <Text style={s.modalInfoLabel}>Tarif mission</Text>
              <Text style={s.modalInfoValue}>~{netEstime(negotiationEligibility?.baseRate ?? negotiationTarget?.salaire ?? 0)}{EURO}/h net</Text>
          </View>
          <View style={s.modalInfoCard}>
              <Text style={s.modalInfoLabel}>Tarif négocié maximum</Text>
              <Text style={s.modalInfoValue}>~{netEstime(negotiationEligibility?.maxAllowedRate ?? negotiationTarget?.salaire ?? 0)}{EURO}/h net</Text>
          </View>
            <Text style={s.modalHelp}>Une seule contre-offre est possible pour cette mission. Le patron verra le tarif en brut.</Text>
            <TextInput
              style={s.rateInput}
              value={negotiationRateInput}
              onChangeText={setNegotiationRateInput}
              placeholder="Ex : 10.5"
              keyboardType="decimal-pad"
              placeholderTextColor={C.textMuted}
            />
            <View style={s.modalActions}>
              <TouchableOpacity style={[s.footerBtn, s.footerBtnGhost]} onPress={fermerNegociation} activeOpacity={0.85}>
                <Text style={s.footerBtnGhostTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.footerBtn, s.footerBtnPrimary, negotiationSubmitting && s.footerBtnDisabled]} onPress={envoyerContreOffre} disabled={negotiationSubmitting} activeOpacity={0.85}>
                <Text style={s.footerBtnPrimaryTxt}>{negotiationSubmitting ? 'Envoi...' : 'Envoyer la contre-offre'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  loadWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { paddingBottom: 126 },
  header: { marginHorizontal: 16, marginTop: 50, marginBottom: 12, paddingHorizontal: 22, paddingVertical: 22, backgroundColor: '#FBF7F1', borderRadius: 30, borderWidth: 1, borderColor: '#E7DDD0', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', shadowColor: '#2B2118', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 10 }, shadowRadius: 18, elevation: 2 },
  headerText: { flex: 1, paddingRight: 16 },
  overline: { fontSize: 10, color: C.textMuted, marginBottom: 10, fontWeight: '800', letterSpacing: 1.4 },
  name: { fontSize: 30, fontWeight: '800', color: C.title, letterSpacing: -0.9, lineHeight: 34 },
  nameAccent: { fontSize: 30, fontWeight: '800', color: '#245E42', letterSpacing: -0.9, lineHeight: 34, marginTop: 1 },
  headerSub: { fontSize: 13, color: C.textSoft, marginTop: 10, lineHeight: 20, maxWidth: 270 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFFCF8', borderWidth: 1, borderColor: '#E5DACB', alignItems: 'center', justifyContent: 'center', shadowColor: '#2B2118', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 5 }, shadowRadius: 12, elevation: 2 },
  avatarImage: { width: '100%', height: '100%', borderRadius: 32 },
  avatarText: { fontSize: 18, fontWeight: '800', color: C.title },
  avatarDot: { position: 'absolute', bottom: 3, right: 3, width: 13, height: 13, borderRadius: 7, backgroundColor: C.accent, borderWidth: 2, borderColor: '#FFFCF8' },
  avatarDotOff: { backgroundColor: C.textMuted },
  statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 12 },
  statCard: { flex: 1, minHeight: 96, backgroundColor: '#FCFAF7', borderRadius: 24, borderWidth: 1, borderColor: '#E8DED0', paddingHorizontal: 10, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', shadowColor: '#2B2118', shadowOpacity: 0.03, shadowOffset: { width: 0, height: 6 }, shadowRadius: 12, elevation: 1 },
  statCardActive: { borderColor: '#245E42', backgroundColor: '#245E42', shadowColor: '#1F6B45', shadowOpacity: 0.16, shadowOffset: { width: 0, height: 8 }, shadowRadius: 16, elevation: 3 },
  statBadge: { position: 'absolute', top: 10, right: 10, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  statBadgeActive: { backgroundColor: '#FFFFFF' },
  statBadgeText: { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
  statBadgeTextActive: { color: '#245E42' },
  statNum: { fontSize: 28, fontWeight: '800', letterSpacing: -0.7, marginBottom: 4, color: C.title },
  statNumActive: { color: '#FFFFFF' },
  statLbl: { fontSize: 11, color: C.textMuted, fontWeight: '800', textAlign: 'center', lineHeight: 14 },
  statLblActive: { color: '#FFFFFF' },
  quickAccessRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 4 },
  quickAccessCard: { flex: 1, minHeight: 96, backgroundColor: '#FFFCF8', borderRadius: 24, borderWidth: 1, borderColor: '#E8DED0', paddingHorizontal: 16, paddingVertical: 16, justifyContent: 'space-between', shadowColor: '#2B2118', shadowOpacity: 0.03, shadowOffset: { width: 0, height: 6 }, shadowRadius: 12, elevation: 1 },
  quickAccessEyebrow: { fontSize: 10, color: C.textMuted, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  quickAccessTitle: { fontSize: 17, fontWeight: '800', color: C.title, marginTop: 2, marginBottom: 6, letterSpacing: -0.25 },
  quickAccessMeta: { fontSize: 12, color: C.textSoft, fontWeight: '700' },
  sectionHeader: { paddingHorizontal: 20, paddingTop: 26, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 22, fontWeight: '800', color: C.title, letterSpacing: -0.45 },
  sectionLink: { fontSize: 13, color: C.textSoft, fontWeight: '800' },
  sectionBadge: { minWidth: 28, height: 28, borderRadius: 14, backgroundColor: '#EADBC8', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  sectionBadgeTxt: { fontSize: 11, fontWeight: '800', color: '#70513A' },
  sectionBadgeActive: { backgroundColor: '#245E42', borderWidth: 1, borderColor: '#245E42' },
  sectionBadgeTxtActive: { color: '#FFFFFF' },
  list: { paddingHorizontal: 16 },
  card: { backgroundColor: '#FFFCF8', borderRadius: 28, borderWidth: 1, borderColor: '#E8DED0', padding: 18, shadowColor: '#2B2118', shadowOpacity: 0.032, shadowOffset: { width: 0, height: 8 }, shadowRadius: 16, elevation: 2 },
  cardConfirmed: { backgroundColor: '#FFFCF8', borderRadius: 28, borderWidth: 1, borderColor: '#DEE7E0', padding: 18, shadowColor: '#2B2118', shadowOpacity: 0.032, shadowOffset: { width: 0, height: 8 }, shadowRadius: 16, elevation: 2 },
  cardMb: { marginBottom: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  iconWrap: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 12, borderWidth: 1, borderColor: '#F3E9DC' },
  iconImage: { width: '100%', height: '100%', borderRadius: 16 },
  iconTxt: { fontSize: 13, fontWeight: '800' },
  cardPoste: { fontSize: 16, fontWeight: '800', color: C.title, letterSpacing: -0.2 },
  cardResto: { fontSize: 12, color: C.textMuted, marginTop: 3, fontWeight: '600' },
  badge: { alignSelf: 'flex-start', backgroundColor: C.terraBg, borderWidth: 1, borderColor: C.terraBd, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeTxt: { fontSize: 10, fontWeight: '800', color: C.terra, letterSpacing: 0.3 },
  badgeConfirmed: { alignSelf: 'flex-start', backgroundColor: '#EEF7F1', borderWidth: 1, borderColor: '#D2E3D7', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeConfirmedTxt: { fontSize: 10, fontWeight: '800', color: '#245E42', letterSpacing: 0.3 },
  badgeTracked: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeTrackedTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.35 },
  negotiationBanner: { backgroundColor: C.terraBg, borderWidth: 1, borderColor: C.terraBd, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10, marginBottom: 12 },
  negotiationBannerText: { fontSize: 12, color: C.terra, fontWeight: '700', lineHeight: 17 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  tag: { backgroundColor: C.cardSoft, borderWidth: 1, borderColor: C.borderSoft, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  tagTxt: { fontSize: 11, color: C.textSoft, fontWeight: '600' },
  salaireRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 3 },
  salaire: { fontSize: 24, fontWeight: '800', color: C.title, letterSpacing: -0.65 },
  salaireLbl: { fontSize: 12, color: C.textMuted },
  detailList: { gap: 8, marginBottom: 14, backgroundColor: '#FAF6EF', borderRadius: 20, borderWidth: 1, borderColor: '#EFE6D9', paddingHorizontal: 14, paddingVertical: 13 },
  detailListCompact: { gap: 5, marginTop: 8 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 3 },
  detailRowCompact: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 1 },
  detailLabel: { fontSize: 11, color: C.textMuted, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  detailValue: { flex: 1, textAlign: 'right', fontSize: 12, color: '#211C17', fontWeight: '700' },
  detailValueStrong: { flex: 1, textAlign: 'right', fontSize: 13, color: '#16120F', fontWeight: '800' },
  negotiationHint: { marginTop: 4, marginBottom: 10, fontSize: 12, color: C.terra, fontWeight: '700' },
  statusStrip: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12 },
  statusStripLabel: { fontSize: 11, color: C.textMuted, fontWeight: '800', textTransform: 'uppercase' },
  statusStripValue: { fontSize: 13, fontWeight: '800' },
  checklistCard: { backgroundColor: '#FAF6EF', borderWidth: 1, borderColor: '#EFE6D9', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 },
  checklistRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 3 },
  checklistDot: { width: 26, fontSize: 10, fontWeight: '800' },
  checklistDotDone: { color: C.accent },
  checklistDotTodo: { color: C.terra },
  checklistText: { fontSize: 12, color: C.textSoft, fontWeight: '600' },
  checklistTextDone: { color: C.title, fontWeight: '800' },
  infoBox: { marginTop: 10, marginBottom: 8, backgroundColor: '#F7F1E8', borderWidth: 1, borderColor: '#EDE1CF', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12 },
  infoText: { fontSize: 12, color: C.textSoft, lineHeight: 18, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { minHeight: 48, borderRadius: 15, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  btnAccept: { flex: 1, backgroundColor: C.accent, borderColor: '#1D5F3E', shadowColor: '#1F6B45', shadowOpacity: 0.18, shadowOffset: { width: 0, height: 7 }, shadowRadius: 14, elevation: 2 },
  btnAcceptTxt: { fontSize: 13, fontWeight: '800', color: '#fff' },
  btnRefus: { paddingHorizontal: 16, backgroundColor: C.redBg, borderColor: C.redBd },
  btnRefusTxt: { fontSize: 13, fontWeight: '800', color: C.red },
  btnGhost: { backgroundColor: '#FBF7F0', borderColor: '#EDE3D7' },
  btnDisabled: { opacity: 0.55 },
  btnGhostFull: { marginTop: 10, width: '100%' },
  negotiationDisabledText: { marginTop: 8, fontSize: 12, color: C.textSoft, lineHeight: 18, fontWeight: '600' },
  missionCard: { backgroundColor: '#FFFCF8', borderRadius: 28, borderWidth: 1, borderColor: '#E8DED0', padding: 17, shadowColor: '#2B2118', shadowOpacity: 0.032, shadowOffset: { width: 0, height: 8 }, shadowRadius: 16, elevation: 2 },
  missionRow: { flexDirection: 'row', alignItems: 'center' },
  missionIcon: { width: 52, height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 13, flexShrink: 0, borderWidth: 1, borderColor: '#F0E5D8' },
  missionIconTxt: { fontSize: 13, fontWeight: '800' },
  missionBody: { flex: 1, minWidth: 0 },
  missionPoste: { fontSize: 16, fontWeight: '800', color: C.title, letterSpacing: -0.2 },
  missionResto: { fontSize: 12, color: C.textMuted, marginTop: 3, fontWeight: '600' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 },
  metaPill: { backgroundColor: C.cardSoft, borderWidth: 1, borderColor: C.borderSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, marginRight: 5, marginBottom: 5 },
  metaTxt: { fontSize: 10, color: C.textSoft, fontWeight: '600' },
  missionHours: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  missionRight: { alignItems: 'flex-end', marginLeft: 10, flexShrink: 0 },
  missionPrice: { fontSize: 18, fontWeight: '800', color: C.title, marginBottom: 2, letterSpacing: -0.3 },
  missionPriceHint: { fontSize: 10, color: C.textMuted, fontWeight: '700' },
  missionFooter: { flexDirection: 'row', gap: 10, marginTop: 14 },
  footerBtn: { flex: 1, minHeight: 48, borderRadius: 15, paddingVertical: 12, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  footerBtnSingle: { marginTop: 14 },
  footerBtnGhost: { backgroundColor: '#FBF7F0', borderColor: '#EDE3D7' },
  footerBtnGhostTxt: { fontSize: 13, fontWeight: '800', color: C.textSoft },
  footerBtnPrimary: { backgroundColor: C.accent, borderColor: '#1D5F3E', shadowColor: '#1F6B45', shadowOpacity: 0.18, shadowOffset: { width: 0, height: 7 }, shadowRadius: 14, elevation: 2 },
  footerBtnPrimaryTxt: { fontSize: 13, fontWeight: '800', color: '#fff' },
  footerBtnDisabled: { opacity: 0.6 },
  emptyCard: { marginHorizontal: 16, backgroundColor: '#FFFCF8', borderRadius: 28, borderWidth: 1, borderColor: '#E8DED0', paddingHorizontal: 20, paddingVertical: 24, alignItems: 'center', shadowColor: '#2B2118', shadowOpacity: 0.03, shadowOffset: { width: 0, height: 6 }, shadowRadius: 12, elevation: 1 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: C.title, textAlign: 'center', marginBottom: 7 },
  emptySub: { fontSize: 12, color: C.textSoft, textAlign: 'center', lineHeight: 18 },
  emptyBtn: { marginTop: 14, minHeight: 48, backgroundColor: C.accent, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 16, justifyContent: 'center', shadowColor: '#1F6B45', shadowOpacity: 0.18, shadowOffset: { width: 0, height: 7 }, shadowRadius: 14, elevation: 2 },
  emptyBtnTxt: { fontSize: 13, fontWeight: '800', color: '#fff' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,22,20,0.34)' },
  modalBackdrop: { flex: 1 },
  modalSheet: { backgroundColor: '#FFFCF8', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 22, borderTopWidth: 1, borderTopColor: C.border, shadowColor: '#2B2118', shadowOpacity: 0.08, shadowOffset: { width: 0, height: -4 }, shadowRadius: 18, elevation: 6 },
  modalHandle: { alignSelf: 'center', width: 46, height: 5, borderRadius: 999, backgroundColor: '#DCCFBE', marginBottom: 16 },
  modalTitle: { fontSize: 21, fontWeight: '800', color: C.title, marginBottom: 4 },
  modalSub: { fontSize: 13, color: C.textSoft, marginBottom: 15 },
  modalInfoCard: { backgroundColor: '#FAF6EF', borderWidth: 1, borderColor: '#EFE6D9', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 10 },
  modalInfoLabel: { fontSize: 11, color: C.textMuted, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
  modalInfoValue: { fontSize: 15, color: C.title, fontWeight: '800' },
  modalHelp: { fontSize: 12, color: C.textSoft, lineHeight: 18, marginBottom: 10 },
  rateInput: { borderWidth: 1, borderColor: C.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, color: C.title, backgroundColor: '#FFFCF8', marginBottom: 14 },
  modalActions: { flexDirection: 'row', gap: 10 },
  perfGrid: { marginHorizontal: 16, flexDirection: 'row', marginBottom: 14 },
  perfMain: { flex: 1, backgroundColor: '#FFFCF8', borderRadius: 28, borderWidth: 1, borderColor: '#E8DED0', padding: 18, marginRight: 10, shadowColor: '#2B2118', shadowOpacity: 0.03, shadowOffset: { width: 0, height: 6 }, shadowRadius: 12, elevation: 1 },
  perfEyebrow: { fontSize: 10, color: C.textMuted, fontWeight: '800', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.7 },
  perfBig: { fontSize: 36, fontWeight: '800', color: C.title, letterSpacing: -1, lineHeight: 40 },
  perfBadge: { alignSelf: 'flex-start', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, marginTop: 8, marginBottom: 13 },
  perfBadgeTxt: { fontSize: 11, fontWeight: '800' },
  progressTrack: { height: 7, backgroundColor: '#E7DCCD', borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: 7, backgroundColor: C.accent, borderRadius: 999 },
  perfSide: { width: PERF_RIGHT_WIDTH },
  perfSmall: { flex: 1, backgroundColor: '#FFFCF8', borderRadius: 24, borderWidth: 1, borderColor: '#E8DED0', padding: 13, shadowColor: '#2B2118', shadowOpacity: 0.028, shadowOffset: { width: 0, height: 5 }, shadowRadius: 10, elevation: 1 },
  perfSmallSpacing: { marginTop: 10 },
  perfSmallIcon: { fontSize: 14, marginBottom: 6 },
  perfSmallVal: { fontSize: 22, fontWeight: '800', color: C.title, letterSpacing: -0.5 },
  perfSmallLbl: { marginTop: 4, fontSize: 10, color: C.textSoft, fontWeight: '800' },
})
