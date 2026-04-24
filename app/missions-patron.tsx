import { useFocusEffect, useRouter } from 'expo-router'
import React, { useCallback, useState } from 'react'
import { Alert, Modal, Platform, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, ToastAndroid, TouchableOpacity, View } from 'react-native'
import PatronBottomNav from '../components/PatronBottomNav'
import { ANNONCE_COMPAT_SELECT, ANNONCE_COMPAT_WITH_WORKFLOW_SELECT, normalizeAnnonceRecords, type NormalizedAnnonceRecord } from '../lib/annonce-read'
import { cancelConfirmedAnnonce, markMissionCheckIn, markMissionCheckOut, markMissionDpaeDone, openUrgentMissionReplacement, syncAnnoncesInProgress, updateAnnonceLifecycleStatus } from '../lib/annonces'
import { fetchContractMapForEngagements, getContractWarnings, type ContractRecord } from '../lib/contracts'
import { EURO } from '../lib/currency'
import { saveEvaluation } from '../lib/evaluations'
import { fetchEtablissementNameMapByIds } from '../lib/etablissements'
import { fetchEngagementMapForMissions, getEngagementStatusLabel, getEngagementWarnings, type EngagementRecord } from '../lib/engagements'
import { isActiveMissionStatus, normalizeMissionStatus, parseMissionDateTime } from '../lib/missions'
import { getCheckInBlockMessage, getCheckOutBlockMessage, getMissionLifecycleIssues, getMissionValidationSummary, getUrgentReplacementBlockMessage, type MissionValidationSnapshot } from '../lib/mission-validation'
import { syncReferralRewardsForReferredUser } from '../lib/referrals'
import { syncServeurMissionStats } from '../lib/serveur-stats'
import { supabase } from '../lib/supabase'

type MissionPatron = Pick<
  NormalizedAnnonceRecord,
  | 'id'
  | 'poste'
  | 'date'
  | 'heure_debut'
  | 'heure_fin'
  | 'salaire'
  | 'ville'
  | 'statut'
  | 'serveur_id'
  | 'etablissement_id'
  | 'presence_confirmation_status'
  | 'contract_status'
  | 'payment_status'
  | 'launch_offer_applied'
  | 'check_in_status'
  | 'dpae_done'
  | 'dpae_status'
  | 'checked_in_at'
  | 'checked_out_at'
  | 'check_out_requested_by'
  | 'check_out_requested_at'
  | 'check_out_confirmed_at'
>

type RatingModalState = {
  missionId: string
  serveurId: string
  serveurNom: string
} | null

const C = {
  bg: '#F7F4EE',
  card: '#FFFFFF',
  cardWarm: '#FCF8F2',
  border: '#EDE8DF',
  borderSoft: '#F0EBE3',
  title: '#171614',
  text: '#2A2723',
  muted: '#B0A89C',
  soft: '#7A7166',
  softDark: '#5F574C',
  terra: '#C46A3C',
  terraDark: '#9F542D',
  terraBg: '#FEF3EB',
  terraBd: '#F5C9A9',
  green: '#2E8B57',
  greenBg: '#F0F8F3',
  greenBd: '#C0DEC8',
  red: '#C84B4B',
  redBg: '#FEF2F2',
  redBd: '#F2CACA',
  shadow: '#2B2118',
}

function canFlagNoShow(mission: MissionPatron) {
  const now = new Date()
  const start = parseMissionDateTime(mission.date, mission.heure_debut)
  if (!start) return false
  const allowedAt = new Date(start.getTime() + 10 * 60 * 1000)
  return now >= allowedAt
}

function getMissionBadge(mission: MissionPatron) {
  if (normalizeMissionStatus(mission.statut) === 'in_progress') {
    return {
      label: 'En cours',
      bg: C.greenBg,
      border: C.greenBd,
      color: C.green,
    }
  }

  return {
    label: 'Confirmée',
    bg: C.greenBg,
    border: C.greenBd,
    color: C.green,
  }
}

function buildMissionValidationSnapshot(
  mission: MissionPatron,
  engagement: EngagementRecord | undefined,
  contract: ContractRecord | null
): MissionValidationSnapshot {
  return {
    statut: mission.statut,
    presence_confirmation_status: mission.presence_confirmation_status,
    date: mission.date,
    heure_debut: mission.heure_debut,
    heure_fin: mission.heure_fin,
    engagement_status: engagement?.status ?? null,
    dpae_done: mission.dpae_done ?? null,
    dpae_status: mission.dpae_status ?? null,
    contract_status: contract?.status ?? null,
    payment_status: mission.payment_status ?? null,
    check_in_status: mission.check_in_status ?? (engagement?.checked_out_at
      ? 'checked_out'
      : engagement?.checked_in_at
        ? 'checked_in'
        : 'not_checked_in'),
    engagement_checked_in_at: mission.checked_in_at ?? engagement?.checked_in_at ?? null,
    engagement_checked_out_at: mission.checked_out_at ?? engagement?.checked_out_at ?? null,
  }
}

export default function MissionsPatron() {
  const router = useRouter()
  const [missions, setMissions] = useState<MissionPatron[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [serveurs, setServeurs] = useState<Record<string, string>>({})
  const [etablissementNames, setEtablissementNames] = useState<Record<string, string>>({})
  const [engagements, setEngagements] = useState<Record<string, EngagementRecord>>({})
  const [contracts, setContracts] = useState<Record<string, ContractRecord>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [ratingModal, setRatingModal] = useState<RatingModalState>(null)
  const [ratingNote, setRatingNote] = useState(0)
  const [ratingComment, setRatingComment] = useState('')
  const [ratingLoading, setRatingLoading] = useState(false)

  const chargerDonnees = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      router.replace('/')
      return
    }
    setCurrentUserId(user.id)

    let annoncesRows: any[] | null = null
    const { data: workflowData, error: workflowError } = await supabase
      .from('annonces')
      .select(ANNONCE_COMPAT_WITH_WORKFLOW_SELECT)
      .eq('patron_id', user.id)
      .order('date', { ascending: true })
      .order('heure_debut', { ascending: true })

    if (workflowError && /check_in_status|checked_in_at|checked_out_at|check_out_requested_|check_out_confirmed_at|dpae_|contract_status|payment_status|launch_offer_applied/i.test(String(workflowError.message ?? ''))) {
      const { data: compatData, error: compatError } = await supabase
        .from('annonces')
        .select(ANNONCE_COMPAT_SELECT)
        .eq('patron_id', user.id)
        .order('date', { ascending: true })
        .order('heure_debut', { ascending: true })

      if (compatError) return

      annoncesRows = (compatData ?? []).map((item: any) => ({
        ...item,
        checked_out_at: null,
        check_out_requested_by: null,
        check_out_requested_at: null,
        check_out_confirmed_at: null,
        launch_offer_applied: false,
      }))
    } else if (!workflowError) {
      annoncesRows = workflowData ?? null
    }

    if (!annoncesRows) return

    const normalizedRows = normalizeAnnonceRecords(annoncesRows as any[])
    const trackedMissions = normalizedRows.filter((mission) => isActiveMissionStatus(mission.statut)) as MissionPatron[]

    const progressedMissionIds = await syncAnnoncesInProgress(trackedMissions)

    const normalizedMissions = trackedMissions.map((mission) =>
      progressedMissionIds.includes(mission.id)
        ? { ...mission, statut: 'in_progress' }
        : mission
    )

    const dpaeMap: Record<string, boolean | null> = {}
    const dpaeStatusMap: Record<string, string | null> = {}
    const { data: dpaeRows, error: dpaeError } = await supabase
      .from('dpae_records')
      .select('mission_id, status')
      .in('mission_id', normalizedMissions.map((mission) => mission.id))

    if (!dpaeError) {
      ;(dpaeRows ?? []).forEach((row: any) => {
        const missionId = String(row.mission_id)
        dpaeStatusMap[missionId] = row.status ?? 'not_started'
        dpaeMap[missionId] = row.status === 'confirmed'
      })
    }

    const missionsWithDpae = normalizedMissions.map((mission) => ({
      ...mission,
      dpae_done: Object.prototype.hasOwnProperty.call(dpaeMap, mission.id) ? dpaeMap[mission.id] : (mission.dpae_done ?? false),
      dpae_status: Object.prototype.hasOwnProperty.call(dpaeStatusMap, mission.id) ? dpaeStatusMap[mission.id] : (mission.dpae_status ?? 'not_started'),
    }))

    const missionsDashboard = missionsWithDpae.filter((mission) => isActiveMissionStatus(mission.statut))
    const missionsFiltered = missionsDashboard.filter((mission) => isActiveMissionStatus(mission.statut))

    console.log('missions dashboard', missionsDashboard.length)
    console.log('missions onglet', missionsFiltered.length)
    console.log('missions statuts', missionsWithDpae.map((mission) => mission.statut))

    setMissions(missionsDashboard)
    setEtablissementNames(await fetchEtablissementNameMapByIds(
      missionsWithDpae.map((mission) => mission.etablissement_id).filter(Boolean) as string[]
    ))
    const nextEngagements = await fetchEngagementMapForMissions(missionsWithDpae.map((mission) => mission.id))
    setEngagements(nextEngagements)
    setContracts(await fetchContractMapForEngagements(Object.values(nextEngagements).map((engagement) => engagement.id)))

    const serveurIds = missionsWithDpae.map((mission) => mission.serveur_id).filter(Boolean)
    if (serveurIds.length === 0) {
      setServeurs({})
      return
    }

    const { data: serveursData } = await supabase
      .from('serveurs')
      .select('id, prenom, nom')
      .in('id', serveurIds as string[])

    const serveurMap: Record<string, string> = {}
    ;(serveursData ?? []).forEach((serveur: any) => {
      serveurMap[serveur.id] = `${serveur.prenom} ${serveur.nom}`
    })
    setServeurs(serveurMap)
  }, [router])

  useFocusEffect(
    useCallback(() => {
      chargerDonnees()
    }, [chargerDonnees])
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await chargerDonnees()
    setRefreshing(false)
  }, [chargerDonnees])

  const missionsEnCours = missions.filter((mission) => isActiveMissionStatus(mission.statut))

  const syncServeurOutcomeStats = useCallback(async (serveurId: string | null | undefined) => {
    if (!serveurId) return
    await syncServeurMissionStats(serveurId)
  }, [])

  const handleViewProfil = useCallback(
    (mission: MissionPatron) => {
      if (!mission.serveur_id) return
      router.push({
        pathname: '/profil-serveur-public',
        params: {
          serveurId: mission.serveur_id,
          annonceId: mission.id,
        },
      })
    },
    [router]
  )

  const handleViewContract = useCallback(
    (missionId: string, engagementId?: string | null) => {
      router.push({
        pathname: '/contrat-engagement',
        params: {
          annonceId: missionId,
          engagementId: engagementId ?? '',
        },
      })
    },
    [router]
  )

  const handleAnnulerMission = useCallback(
    (missionId: string) => {
      Alert.alert('Confirmer', 'Annuler cette mission ?', [
        { text: 'Retour', style: 'cancel' },
        {
          text: 'Annuler la mission',
          style: 'destructive',
          onPress: async () => {
            const result = await cancelConfirmedAnnonce(missionId, 'patron')
            if (!result.ok) {
              Alert.alert('Erreur', "Impossible d'annuler cette mission.")
              return
            }
            await chargerDonnees()
          },
        },
      ])
    },
    [chargerDonnees]
  )

  const handleUrgentReplacement = useCallback(
    (mission: MissionPatron) => {
      const engagement = engagements[mission.id]
      const contract = engagement ? contracts[engagement.id] ?? null : null
      const blockMessage = getUrgentReplacementBlockMessage(
        buildMissionValidationSnapshot(mission, engagement, contract)
      )
      if (blockMessage) {
        Alert.alert('Remplacement indisponible', blockMessage)
        return
      }

      Alert.alert(
        'Mode urgence',
        "Le remplacement urgent va annuler l'engagement actuel et rouvrir la mission pour trouver un remplacant. Un nouvel engagement sera cree ensuite.",
        [
          { text: 'Retour', style: 'cancel' },
          {
            text: 'Lancer le remplacement',
            style: 'destructive',
            onPress: async () => {
              const result = await openUrgentMissionReplacement(mission.id)
              if (!result.ok) {
                Alert.alert('Erreur', result.message ?? "Impossible d'ouvrir le remplacement urgent.")
                return
              }

              await chargerDonnees()
              router.push({
                pathname: '/serveurs-disponibles',
                params: {
                  annonceId: mission.id,
                  replaceEngagementId: result.replacedEngagementId ?? '',
                },
              })
            },
          },
        ]
      )
    },
    [chargerDonnees, contracts, engagements, router]
  )

  const handleTerminerMission = useCallback(
    (mission: MissionPatron) => {
      Alert.alert('Confirmer', 'Marquer cette mission comme terminee ?', [
        { text: 'Retour', style: 'cancel' },
        {
          text: 'Mission terminee',
          onPress: async () => {
            const result = await updateAnnonceLifecycleStatus(mission.id, 'completed')
            if (!result.ok) {
              Alert.alert('Erreur', "Impossible d'enregistrer la fin de mission.")
              return
            }
            if (result.changed) {
              await syncServeurOutcomeStats(mission.serveur_id)
              if (mission.serveur_id) {
                await syncReferralRewardsForReferredUser(mission.serveur_id)
              }
            }
            await chargerDonnees()
          },
        },
      ])
    },
    [chargerDonnees, syncServeurOutcomeStats]
  )

  const handleCheckIn = useCallback(
    (mission: MissionPatron, blockMessage: string | null) => {
      if (blockMessage) {
        Alert.alert('Check-in indisponible', blockMessage)
        return
      }

      Alert.alert('Confirmer', 'Enregistrer le check-in pour cette mission ?', [
        { text: 'Retour', style: 'cancel' },
        {
          text: 'Check-in',
          onPress: async () => {
            const result = await markMissionCheckIn(mission.id)
            if (!result.ok) {
              Alert.alert('Action bloquee', result.message ?? "Impossible d'enregistrer le check-in.")
              return
            }
            await chargerDonnees()
          },
        },
      ])
    },
    [chargerDonnees]
  )

  const handleCheckOut = useCallback(
    (mission: MissionPatron, blockMessage: string | null) => {
      if (blockMessage) {
        Alert.alert('Check-out indisponible', blockMessage)
        return
      }

      Alert.alert('Confirmer', 'Enregistrer le check-out pour cette mission ?', [
        { text: 'Retour', style: 'cancel' },
        {
          text: 'Check-out',
          onPress: async () => {
            const result = await markMissionCheckOut(mission.id)
            if (!result.ok) {
              Alert.alert('Action bloquee', result.message ?? "Impossible d'enregistrer le check-out.")
              return
            }
            await chargerDonnees()
            if (result.stage === 'pending_confirmation') {
              Alert.alert('Check-out demandé', 'Le check-out est en attente de confirmation par l’autre partie.')
              return
            }
            if (mission.serveur_id) {
              setRatingModal({
                missionId: mission.id,
                serveurId: mission.serveur_id,
                serveurNom: serveurs[mission.serveur_id] ?? 'le serveur',
              })
              setRatingNote(0)
              setRatingComment('')
              setRatingLoading(false)
            }
          },
        },
      ])
    },
    [chargerDonnees, serveurs]
  )

  const closeRatingModal = useCallback(() => {
    if (ratingLoading) return
    setRatingModal(null)
    setRatingNote(0)
    setRatingComment('')
    setRatingLoading(false)
  }, [ratingLoading])

  const submitRating = useCallback(async () => {
    if (!ratingModal || ratingNote === 0) {
      Alert.alert('Erreur', 'Veuillez choisir une note')
      return
    }

    setRatingLoading(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        throw new Error('User not found')
      }

      await saveEvaluation({
        serveurId: ratingModal.serveurId,
        missionId: ratingModal.missionId,
        patronId: user.id,
        note: ratingNote,
        commentaire: ratingComment,
      })

      await supabase
        .from('annonces')
        .update({ note: ratingNote })
        .eq('id', ratingModal.missionId)

      await chargerDonnees()
      closeRatingModal()
      Alert.alert('Succes', 'Note enregistree')
    } catch (error) {
      console.error('missions patron submitRating error', error)
      Alert.alert('Erreur', 'Le check-out est bien enregistre, mais la note n a pas pu etre sauvegardee.')
      setRatingLoading(false)
    }
  }, [chargerDonnees, closeRatingModal, ratingComment, ratingModal, ratingNote])

  const handleMarkDpaeDone = useCallback(
    async (mission: MissionPatron, missionSummary: ReturnType<typeof getMissionValidationSummary>, dpaeBlockMessage: string | null) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      console.log('mission dpae ui debug', {
        mission_id: mission.id,
        patron_id: user?.id ?? null,
        etablissement_id: mission.etablissement_id ?? null,
        statut_mission: mission.statut ?? null,
        statut_dpae: mission.dpae_status ?? null,
        dpae_done: mission.dpae_done ?? null,
        pre_requis: {
          agreement_confirmed: missionSummary.isAgreementConfirmed,
          contract_status: missionSummary.contractStatus,
          contract_display: missionSummary.contractDisplayLabel,
        },
        blocked_message: dpaeBlockMessage,
      })

      if (dpaeBlockMessage) {
        Alert.alert('Déclaration URSSAF indisponible', dpaeBlockMessage)
        return
      }

      Alert.alert('Declaration URSSAF', 'La declaration URSSAF doit etre realisee hors application par le patron avant le debut de mission. Confirmez ici uniquement si elle a bien ete effectuee.', [
        { text: 'Retour', style: 'cancel' },
        {
          text: 'Voir le detail',
          onPress: () => {
            router.push({
              pathname: '/contrat-engagement',
              params: {
                annonceId: mission.id,
              },
            })
          },
        },
        {
          text: 'Confirmer la declaration',
          onPress: async () => {
            const result = await markMissionDpaeDone(mission.id)
            if (!result.ok) {
              const backendMessage = result.message?.trim() || 'Impossible de confirmer la DPAE.'
              if (__DEV__ && Platform.OS === 'android') {
                ToastAndroid.show(backendMessage, ToastAndroid.LONG)
              }
              Alert.alert('Impossible de confirmer la DPAE.', backendMessage)
              return
            }
            await chargerDonnees()
          },
        },
      ])
    },
    [chargerDonnees, router]
  )

  const handleNoShow = useCallback(
    (mission: MissionPatron) => {
      Alert.alert('Confirmer', "Confirmer que la personne ne s'est pas presentee ? Cette action impactera sa fiabilite.", [
        { text: 'Retour', style: 'cancel' },
        {
          text: 'Declarer absent',
          style: 'destructive',
          onPress: async () => {
            const result = await updateAnnonceLifecycleStatus(mission.id, 'no_show')
            if (!result.ok) {
              Alert.alert('Erreur', "Impossible d'enregistrer l'absence.")
              return
            }
            if (result.changed) {
              await syncServeurOutcomeStats(mission.serveur_id)
            }
            await chargerDonnees()
          },
        },
      ])
    },
    [chargerDonnees, syncServeurOutcomeStats]
  )

  const renderMissionCard = (mission: MissionPatron) => {
    const serveurNom = mission.serveur_id ? serveurs[mission.serveur_id] : null
    const missionBadge = getMissionBadge(mission)
    const isInProgress = normalizeMissionStatus(mission.statut) === 'in_progress'
    const noShowAllowed = canFlagNoShow(mission)
    const engagement = engagements[mission.id]
    const contract = engagement ? contracts[engagement.id] ?? null : null
    const engagementLabel = getEngagementStatusLabel(engagement?.status)
    const validationSnapshot = buildMissionValidationSnapshot(mission, engagement, contract)
    const missionSummary = getMissionValidationSummary(validationSnapshot)
    const checkInBlockMessage = getCheckInBlockMessage(validationSnapshot)
    const checkOutBlockMessage = getCheckOutBlockMessage(validationSnapshot)
    const replacementBlockMessage = getUrgentReplacementBlockMessage(validationSnapshot)
    const hasCheckedIn = Boolean(validationSnapshot.engagement_checked_in_at)
    const hasCheckedOut = Boolean(validationSnapshot.engagement_checked_out_at)
    const checkOutRequestedByMe = Boolean(currentUserId && mission.check_out_requested_by === currentUserId)
    const checkOutRequestedByOther = Boolean(mission.check_out_requested_by && !checkOutRequestedByMe)
    const checkOutActionLabel = checkOutRequestedByOther
      ? 'Confirmer le check-out'
      : checkOutRequestedByMe
        ? 'En attente de confirmation'
        : 'Demander le check-out'
    const warnings = [
      ...getEngagementWarnings(engagement ?? null),
      ...getContractWarnings(contract, engagement ?? null),
      ...getMissionLifecycleIssues(validationSnapshot),
    ]
    const dpaeBlockMessage = missionSummary.dpaeDone
      ? null
      : !missionSummary.isAgreementConfirmed
        ? 'La mission doit etre confirmee avant de finaliser la DPAE.'
        : null
    const actionInfoMessages = Array.from(new Set([
      ...(!missionSummary.isAgreementConfirmed
        ? missionSummary.contractualizationBlockers
        : missionSummary.administrativeBlockers),
      checkInBlockMessage && !hasCheckedIn ? checkInBlockMessage : null,
      checkOutBlockMessage && hasCheckedIn && !hasCheckedOut ? checkOutBlockMessage : null,
      replacementBlockMessage,
    ].filter(Boolean) as string[]))
    const canShowCheckInAction = !hasCheckedIn && !hasCheckedOut
    const canShowCheckOutAction = hasCheckedIn && !hasCheckedOut
    const canShowCompleteAction = hasCheckedOut
    const canExecuteDpaeAction = !missionSummary.dpaeDone && !dpaeBlockMessage
    const dpaeTone = missionSummary.dpaeDone
      ? { bg: C.greenBg, border: C.greenBd, text: C.green }
      : missionSummary.isAgreementConfirmed
        ? { bg: C.terraBg, border: C.terraBd, text: C.terraDark }
        : { bg: C.cardWarm, border: C.borderSoft, text: C.softDark }
    const dpaeLabel = missionSummary.dpaeDone
      ? 'URSSAF confirmée'
      : missionSummary.isAgreementConfirmed
        ? 'URSSAF à finaliser'
        : 'En attente de confirmation'
    const launchOfferApplied =
      mission.payment_status === 'captured' &&
      mission.launch_offer_applied === true
    const shouldShowContractAction =
      missionSummary.isAgreementConfirmed &&
      missionSummary.contractDisplayLabel !== 'Contrat signé' &&
      Boolean(engagement)
    const isPrimaryDpaeAction = !shouldShowContractAction && canExecuteDpaeAction
    const canCancelMission = missionSummary.missionStatusValue === 'pending' && !missionSummary.isAgreementConfirmed
    const contractPatronDone =
      missionSummary.contractStatus === 'signed_by_patron' ||
      missionSummary.contractStatus === 'signed_by_server' ||
      missionSummary.contractStatus === 'fully_signed'
    const contractServeurDone =
      missionSummary.contractStatus === 'signed_by_server' ||
      missionSummary.contractStatus === 'fully_signed'
    const checklistItems = [
      {
        label: 'Contrat employeur',
        done: contractPatronDone,
      },
      {
        label: 'Contrat serveur',
        done: contractServeurDone,
      },
      {
        label: 'DPAE confirmée',
        done: missionSummary.dpaeDone,
      },
      {
        label: 'Prête au démarrage',
        done:
          missionSummary.isReadyForCheckIn ||
          missionSummary.missionStatusValue === 'active' ||
          missionSummary.missionStatusValue === 'completed',
      },
    ]
    const primaryAction = shouldShowContractAction ? (
      <TouchableOpacity style={s.primaryAction} onPress={() => handleViewContract(mission.id, engagement?.id)} activeOpacity={0.88}>
        <Text style={s.primaryActionText}>
          {missionSummary.contractDisplayLabel === 'À signer'
            ? 'Signer le contrat'
            : missionSummary.contractDisplayLabel === 'Contrat signé'
              ? 'Voir le contrat'
              : 'Voir le contrat'}
        </Text>
      </TouchableOpacity>
    ) : isPrimaryDpaeAction ? (
      <TouchableOpacity style={s.primaryAction} onPress={() => handleMarkDpaeDone(mission, missionSummary, dpaeBlockMessage)} activeOpacity={0.88}>
        <Text style={s.primaryActionText}>Declaration URSSAF</Text>
      </TouchableOpacity>
    ) : canShowCheckInAction ? (
      <TouchableOpacity
        style={[s.primaryAction, checkInBlockMessage ? s.primaryActionDisabled : null]}
        onPress={() => handleCheckIn(mission, checkInBlockMessage)}
        activeOpacity={checkInBlockMessage ? 1 : 0.88}
        disabled={Boolean(checkInBlockMessage)}
      >
        <Text style={[s.primaryActionText, checkInBlockMessage ? s.primaryActionTextDisabled : null]}>Check-in</Text>
      </TouchableOpacity>
    ) : canShowCheckOutAction ? (
      <TouchableOpacity
        style={[s.primaryAction, checkOutRequestedByMe ? s.primaryActionDisabled : null]}
        onPress={() => handleCheckOut(mission, checkOutBlockMessage)}
        activeOpacity={checkOutRequestedByMe ? 1 : 0.88}
        disabled={checkOutRequestedByMe}
      >
        <Text style={[s.primaryActionText, checkOutRequestedByMe ? s.primaryActionTextDisabled : null]}>
          {checkOutActionLabel}
        </Text>
      </TouchableOpacity>
    ) : canShowCompleteAction ? (
      <TouchableOpacity style={s.primaryAction} onPress={() => handleTerminerMission(mission)} activeOpacity={0.88}>
        <Text style={s.primaryActionText}>Mission terminee</Text>
      </TouchableOpacity>
    ) : null

    return (
      <View key={mission.id} style={s.missionCard}>
        <View style={s.missionTop}>
          <View style={{ flex: 1 }}>
            <Text style={s.missionTitle}>{mission.poste}</Text>
            <Text style={s.missionMeta}>{mission.etablissement_id ? etablissementNames[mission.etablissement_id] ?? mission.ville : mission.ville}</Text>
            <Text style={s.missionMeta}>{mission.ville} - {mission.date}</Text>
          </View>
          <View style={[s.statusBadge, { backgroundColor: missionBadge.bg, borderColor: missionBadge.border }]}>
            <Text style={[s.statusBadgeText, { color: missionBadge.color }]}>{missionBadge.label}</Text>
          </View>
        </View>

        <View style={s.infoRow}>
          <View style={s.infoCard}>
            <Text style={s.infoLabel}>Horaire</Text>
            <Text style={s.infoValue}>{mission.heure_debut} - {mission.heure_fin}</Text>
          </View>
          <View style={s.infoCard}>
            <Text style={s.infoLabel}>
              {engagement?.agreed_hourly_rate != null && engagement.agreed_hourly_rate !== mission.salaire ? 'Tarif retenu' : 'Tarif mission'}
            </Text>
            <Text style={s.infoValue}>{`${engagement?.agreed_hourly_rate ?? mission.salaire}${EURO} / h brut`}</Text>
          </View>
        </View>

        {serveurNom && (
          <View style={s.assignedRow}>
            <Text style={s.assignedLabel}>Profil selectionne</Text>
            <Text style={s.assignedName}>{serveurNom}</Text>
          </View>
        )}

        <View style={s.assignedRow}>
          <Text style={s.assignedLabel}>Statut mission</Text>
          <Text style={s.assignedName}>{missionSummary.missionStatusLabel}</Text>
        </View>

        <View style={s.assignedRow}>
          <Text style={s.assignedLabel}>Contrat</Text>
          <Text style={s.assignedName}>{missionSummary.contractDisplayLabel}</Text>
        </View>

        <View style={[s.statusRowCard, { backgroundColor: dpaeTone.bg, borderColor: dpaeTone.border }]}>
          <Text style={s.statusRowLabel}>URSSAF</Text>
          <Text style={[s.statusRowValue, { color: dpaeTone.text }]}>{dpaeLabel}</Text>
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

        {engagement ? (
          <View style={s.assignedRow}>
            <Text style={s.assignedLabel}>Engagement</Text>
            <Text style={s.assignedName}>{engagementLabel}</Text>
          </View>
        ) : null}

        {launchOfferApplied ? (
          <View style={s.billingInfoBox}>
            <Text style={s.billingInfoTitle}>Paiement</Text>
            <Text style={s.billingInfoText}>Offre de lancement : frais plateforme offerts</Text>
          </View>
        ) : null}

        {warnings.length > 0 && missionSummary.missionStatusValue !== 'pending' && (
          <View style={s.warningBox}>
            <Text style={s.warningTitle}>Verification necessaire</Text>
            {warnings.map((warning) => (
              <Text key={`${mission.id}-${warning}`} style={s.warningText}>{warning}</Text>
            ))}
          </View>
        )}

        {actionInfoMessages.length > 0 && (
          <View style={s.infoBox}>
            <Text style={s.infoBoxTitle}>Blocages a connaitre</Text>
            {actionInfoMessages.map((message, index) => (
              <Text key={`${mission.id}-action-info-${index}`} style={s.infoBoxText}>{message}</Text>
            ))}
          </View>
        )}

        {isInProgress ? (
          <View style={s.actionsWrap}>
            {primaryAction}
            <TouchableOpacity style={s.criticalAction} onPress={() => handleUrgentReplacement(mission)} activeOpacity={0.88}>
              <Text style={s.criticalActionText}>Remplacement urgent</Text>
            </TouchableOpacity>
            {canExecuteDpaeAction && !isPrimaryDpaeAction ? (
              <TouchableOpacity style={s.secondaryAction} onPress={() => handleMarkDpaeDone(mission, missionSummary, dpaeBlockMessage)} activeOpacity={0.88}>
                <Text style={s.secondaryActionText}>Déclaration URSSAF</Text>
              </TouchableOpacity>
            ) : null}
            <View style={s.secondaryActionsRow}>
              {noShowAllowed ? (
                <TouchableOpacity style={s.softDangerAction} onPress={() => handleNoShow(mission)} activeOpacity={0.88}>
                  <Text style={s.softDangerActionText}>Declarer absent</Text>
                </TouchableOpacity>
              ) : (
                <View style={s.softHintAction}>
                  <Text style={s.softHintActionText}>Disponible 10 min apres le debut</Text>
                </View>
              )}
            {engagement ? (
              <TouchableOpacity style={s.softAction} onPress={() => handleViewContract(mission.id, engagement.id)} activeOpacity={0.88}>
                <Text style={s.softActionText}>{contract?.status === 'signed' ? 'Voir le contrat' : 'Signer le contrat'}</Text>
              </TouchableOpacity>
            ) : null}
            </View>
          </View>
        ) : (
          <View style={s.actionsWrap}>
            {primaryAction}
            <TouchableOpacity style={s.criticalAction} onPress={() => handleUrgentReplacement(mission)} activeOpacity={0.88}>
              <Text style={s.criticalActionText}>Remplacement urgent</Text>
            </TouchableOpacity>
            {mission.serveur_id && (
              <TouchableOpacity style={s.secondaryAction} onPress={() => handleViewProfil(mission)} activeOpacity={0.88}>
                <Text style={s.secondaryActionText}>Voir le profil</Text>
              </TouchableOpacity>
            )}
            {engagement && (
              <TouchableOpacity style={s.secondaryAction} onPress={() => handleViewContract(mission.id, engagement.id)} activeOpacity={0.88}>
                <Text style={s.secondaryActionText}>{contract?.status === 'signed' ? 'Voir le contrat' : 'Voir / signer le contrat'}</Text>
              </TouchableOpacity>
            )}
            {canExecuteDpaeAction && !isPrimaryDpaeAction && (
              <TouchableOpacity style={s.secondaryAction} onPress={() => handleMarkDpaeDone(mission, missionSummary, dpaeBlockMessage)} activeOpacity={0.88}>
                <Text style={s.secondaryActionText}>Déclaration URSSAF</Text>
              </TouchableOpacity>
            )}
            {canCancelMission ? (
              <TouchableOpacity style={s.softAction} onPress={() => handleAnnulerMission(mission.id)} activeOpacity={0.88}>
                <Text style={s.softActionText}>Annuler la mission</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </View>
    )
  }

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.terra} />}
      >
        <View style={s.header}>
          <Text style={s.eyebrow}>MISSIONS</Text>
          <Text style={s.title}>Vos missions{'\n'}selectionnees</Text>
          <Text style={s.sub}>Retrouvez ici les missions a venir, les engagements en cours et les suivis de fin de mission.</Text>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>En cours</Text>
          <Text style={s.sectionSub}>
            Retrouvez ici les missions actives annoncees depuis le dashboard.
          </Text>
          {missionsEnCours.length === 0 ? (
            <View style={s.emptyCard}>
              <Text style={s.emptyTitle}>Aucune mission en cours</Text>
              <Text style={s.emptySub}>Les missions actives et deja staffees apparaitront ici.</Text>
            </View>
          ) : (
            missionsEnCours.map(renderMissionCard)
          )}
        </View>
      </ScrollView>

      <PatronBottomNav />

      <Modal visible={ratingModal !== null} transparent animationType="slide" onRequestClose={closeRatingModal}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={closeRatingModal} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Noter le serveur</Text>
            <Text style={s.modalName}>{ratingModal?.serveurNom ?? 'Prestataire'}</Text>
            <View style={s.starsRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity key={n} style={s.starButton} onPress={() => setRatingNote(n)} activeOpacity={0.82}>
                  <View style={[s.starCircle, ratingNote >= n && s.starCircleActive]}>
                    <View style={[s.starDot, ratingNote >= n && s.starDotActive]} />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={s.commentInput}
              placeholder="Commentaire optionnel"
              placeholderTextColor="#9A9388"
              value={ratingComment}
              onChangeText={setRatingComment}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[s.modalPrimaryBtn, ratingLoading && s.modalPrimaryBtnDisabled]}
              onPress={submitRating}
              disabled={ratingLoading}
              activeOpacity={0.78}
            >
              <Text style={s.modalPrimaryBtnText}>{ratingLoading ? 'Validation...' : 'Valider la note'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.modalLaterBtn} onPress={closeRatingModal} activeOpacity={0.8}>
              <Text style={s.modalLaterBtnText}>Plus tard</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { paddingBottom: 124 },
  header: { paddingTop: 56, paddingHorizontal: 24, paddingBottom: 24 },
  eyebrow: { fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: C.muted, marginBottom: 6, fontWeight: '500' },
  title: { fontSize: 30, fontWeight: '700', color: C.title, letterSpacing: -0.4, lineHeight: 34 },
  sub: { marginTop: 10, fontSize: 14, color: C.soft, lineHeight: 20 },
  section: { paddingHorizontal: 20, paddingBottom: 18 },
  sectionTitle: { fontSize: 22, fontWeight: '800', color: C.title, letterSpacing: -0.4, marginBottom: 14 },
  sectionSub: { fontSize: 13, color: C.soft, lineHeight: 19, marginTop: -4, marginBottom: 14 },
  missionCard: {
    backgroundColor: C.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
    marginBottom: 12,
    shadowColor: C.shadow,
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
  },
  missionTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  missionTitle: { fontSize: 18, fontWeight: '800', color: C.title, marginBottom: 4 },
  missionMeta: { fontSize: 13, color: C.soft },
  statusBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginLeft: 10 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  infoRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  infoCard: { flex: 1, backgroundColor: C.cardWarm, borderWidth: 1, borderColor: C.borderSoft, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  infoLabel: { fontSize: 11, fontWeight: '700', color: C.muted, textTransform: 'uppercase', marginBottom: 6 },
  infoValue: { fontSize: 14, fontWeight: '700', color: C.text },
  assignedRow: { backgroundColor: C.cardWarm, borderWidth: 1, borderColor: C.borderSoft, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14 },
  assignedLabel: { fontSize: 11, fontWeight: '700', color: C.muted, textTransform: 'uppercase', marginBottom: 4 },
  assignedName: { fontSize: 14, fontWeight: '700', color: C.text },
  statusRowCard: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14 },
  statusRowLabel: { fontSize: 11, fontWeight: '700', color: C.muted, textTransform: 'uppercase', marginBottom: 4 },
  statusRowValue: { fontSize: 14, fontWeight: '800' },
  checklistCard: { backgroundColor: C.cardWarm, borderWidth: 1, borderColor: C.borderSoft, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14 },
  checklistRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 4 },
  checklistDot: { width: 26, fontSize: 10, fontWeight: '800' },
  checklistDotDone: { color: C.green },
  checklistDotTodo: { color: C.terraDark },
  checklistText: { fontSize: 13, color: C.softDark, fontWeight: '600' },
  checklistTextDone: { color: C.text, fontWeight: '800' },
  billingInfoBox: { backgroundColor: C.greenBg, borderWidth: 1, borderColor: C.greenBd, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14 },
  billingInfoTitle: { fontSize: 12, fontWeight: '800', color: C.green, textTransform: 'uppercase', marginBottom: 4 },
  billingInfoText: { fontSize: 12, color: C.softDark, lineHeight: 18, fontWeight: '700' },
  warningBox: { backgroundColor: C.redBg, borderWidth: 1, borderColor: C.redBd, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14 },
  warningTitle: { fontSize: 12, fontWeight: '800', color: C.red, textTransform: 'uppercase', marginBottom: 4 },
  warningText: { fontSize: 12, color: C.red, lineHeight: 18, fontWeight: '600' },
  infoBox: { backgroundColor: C.greenBg, borderWidth: 1, borderColor: C.greenBd, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14 },
  infoBoxTitle: { fontSize: 12, fontWeight: '800', color: C.green, textTransform: 'uppercase', marginBottom: 4 },
  infoBoxText: { fontSize: 12, color: C.softDark, lineHeight: 18, fontWeight: '600' },
  actionsWrap: { gap: 10 },
  primaryAction: { backgroundColor: C.green, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.greenBd },
  primaryActionText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  primaryActionDisabled: { backgroundColor: C.cardWarm, borderColor: C.borderSoft },
  primaryActionTextDisabled: { color: C.softDark },
  criticalAction: { backgroundColor: C.terra, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.terraBd },
  criticalActionText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  secondaryAction: { backgroundColor: C.cardWarm, borderRadius: 16, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.borderSoft },
  secondaryActionText: { color: C.softDark, fontSize: 14, fontWeight: '700' },
  secondaryActionsRow: { flexDirection: 'row', gap: 10 },
  softAction: { flex: 1, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  softActionText: { color: C.softDark, fontSize: 14, fontWeight: '700' },
  softDangerAction: { flex: 1, borderRadius: 16, borderWidth: 1, borderColor: C.redBd, backgroundColor: C.redBg, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  softDangerActionText: { color: C.red, fontSize: 14, fontWeight: '700' },
  softHintAction: { flex: 1, borderRadius: 16, borderWidth: 1, borderColor: C.borderSoft, backgroundColor: C.cardWarm, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  softHintActionText: { color: C.muted, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(23,22,20,0.28)', justifyContent: 'flex-end' },
  modalBackdrop: { flex: 1 },
  modalSheet: { backgroundColor: C.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, borderWidth: 1, borderColor: C.border },
  modalHandle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 999, backgroundColor: C.borderSoft, marginBottom: 16 },
  modalTitle: { fontSize: 22, fontWeight: '800', color: C.title, textAlign: 'center', marginBottom: 6 },
  modalName: { fontSize: 15, fontWeight: '700', color: C.softDark, textAlign: 'center', marginBottom: 18 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 18 },
  starButton: { padding: 4 },
  starCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.cardWarm },
  starCircleActive: { borderColor: C.terraDark, backgroundColor: C.terraBg },
  starDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#D6CDBF' },
  starDotActive: { backgroundColor: C.terraDark },
  commentInput: { minHeight: 100, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.cardWarm, paddingHorizontal: 14, paddingVertical: 14, textAlignVertical: 'top', fontSize: 14, color: C.text, marginBottom: 12 },
  modalPrimaryBtn: { backgroundColor: C.terra, borderRadius: 16, paddingVertical: 15, alignItems: 'center', borderWidth: 1, borderColor: C.terraDark },
  modalPrimaryBtnDisabled: { opacity: 0.7 },
  modalPrimaryBtnText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  modalLaterBtn: { alignItems: 'center', paddingTop: 12, paddingBottom: 2 },
  modalLaterBtnText: { fontSize: 14, fontWeight: '600', color: C.soft },
  emptyCard: { backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.border, padding: 24, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 8 },
  emptySub: { fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 20 },
})
