import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { ANNONCE_COMPAT_WITH_WORKFLOW_SELECT, normalizeAnnonceRecord } from '../lib/annonce-read'
import { fetchMissionWorkflowSnapshot } from '../lib/annonces'
import { getContractForEngagement, type ContractRecord } from '../lib/contracts'
import { EURO } from '../lib/currency'
import { fetchEtablissementById } from '../lib/etablissements'
import { fetchPatronMissionEvaluationMap, type MissionEvaluationStatus } from '../lib/evaluations'
import { fetchLatestEngagementForMission, type EngagementRecord } from '../lib/engagements'
import { getMissionValidationSummary, type MissionValidationSnapshot } from '../lib/mission-validation'
import { supabase } from '../lib/supabase'

const C = {
  bg: '#F7F4EE',
  card: '#FFFFFF',
  cardWarm: '#FCF8F2',
  border: '#EDE8DF',
  borderSoft: '#F0EBE3',
  title: '#171614',
  soft: '#7A7166',
  softDark: '#5F574C',
  muted: '#B0A89C',
  terra: '#C46A3C',
  terraDark: '#9F542D',
  terraBg: '#FEF3EB',
  terraBd: '#F5C9A9',
  green: '#2E8B57',
  greenDark: '#1F6A42',
  greenBg: '#F0F8F3',
  greenBd: '#C0DEC8',
}

type MissionDetailState = {
  mission: ReturnType<typeof normalizeAnnonceRecord>
  serveurNom: string | null
  etablissementNom: string | null
  engagement: EngagementRecord | null
  contract: ContractRecord | null
  workflow: MissionValidationSnapshot | null
  evaluation: MissionEvaluationStatus
}

function getRatingTone(status: MissionEvaluationStatus['status']) {
  return status === 'rated'
    ? { bg: C.greenBg, border: C.greenBd, text: C.greenDark, label: 'Évaluée' }
    : { bg: C.terraBg, border: C.terraBd, text: C.terraDark, label: 'Évaluation en attente' }
}

function buildRows(items: { label: string; value: string | null | undefined }[]) {
  return items.map((item) => ({
    ...item,
    value: item.value && String(item.value).trim() ? String(item.value) : 'Non disponible',
  }))
}

export default function MissionTermineeDetailScreen() {
  const router = useRouter()
  const { annonceId, engagementId, contractId } = useLocalSearchParams()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [detail, setDetail] = useState<MissionDetailState | null>(null)

  const load = useCallback(async () => {
    const rawAnnonceId = typeof annonceId === 'string' ? annonceId : Array.isArray(annonceId) ? annonceId[0] : null
    const rawEngagementId = typeof engagementId === 'string' ? engagementId : Array.isArray(engagementId) ? engagementId[0] : null
    const rawContractId = typeof contractId === 'string' ? contractId : Array.isArray(contractId) ? contractId[0] : null

    if (!rawAnnonceId && !rawEngagementId && !rawContractId) {
      setDetail(null)
      return
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      router.replace('/')
      return
    }

    let resolvedMissionId = rawAnnonceId
    let resolvedEngagementId = rawEngagementId

    if (!resolvedMissionId && rawContractId) {
      const { data: contractData } = await supabase
        .from('contracts')
        .select('id, mission_id, engagement_id')
        .eq('id', rawContractId)
        .maybeSingle()

      if (contractData?.mission_id) resolvedMissionId = String(contractData.mission_id)
      if (contractData?.engagement_id) resolvedEngagementId = String(contractData.engagement_id)
    }

    if (!resolvedMissionId && resolvedEngagementId) {
      const { data: engagementData } = await supabase
        .from('engagements')
        .select('id, mission_id')
        .eq('id', resolvedEngagementId)
        .maybeSingle()

      if (engagementData?.mission_id) resolvedMissionId = String(engagementData.mission_id)
    }

    let { data, error } = resolvedMissionId
      ? await supabase
          .from('annonces')
          .select(ANNONCE_COMPAT_WITH_WORKFLOW_SELECT)
          .eq('id', resolvedMissionId)
          .maybeSingle()
      : { data: null, error: null as Error | null }

    if ((!data || error) && rawAnnonceId) {
      const { data: engagementByAnnonceId } = await supabase
        .from('engagements')
        .select('id, mission_id')
        .eq('id', rawAnnonceId)
        .maybeSingle()

      if (engagementByAnnonceId?.mission_id) {
        resolvedMissionId = String(engagementByAnnonceId.mission_id)
        resolvedEngagementId = String(engagementByAnnonceId.id)
      } else {
        const { data: contractByAnnonceId } = await supabase
          .from('contracts')
          .select('id, mission_id, engagement_id')
          .eq('id', rawAnnonceId)
          .maybeSingle()

        if (contractByAnnonceId?.mission_id) {
          resolvedMissionId = String(contractByAnnonceId.mission_id)
          resolvedEngagementId = contractByAnnonceId.engagement_id ? String(contractByAnnonceId.engagement_id) : resolvedEngagementId
        }
      }

      if (resolvedMissionId && resolvedMissionId !== rawAnnonceId) {
        const retry = await supabase
          .from('annonces')
          .select(ANNONCE_COMPAT_WITH_WORKFLOW_SELECT)
          .eq('id', resolvedMissionId)
          .maybeSingle()
        data = retry.data
        error = retry.error
      }
    }

    if (error || !data || !resolvedMissionId) {
      setDetail(null)
      return
    }

    const mission = normalizeAnnonceRecord(data as never)
    const explicitEngagement = resolvedEngagementId
      ? ((await supabase
          .from('engagements')
          .select(
            'id, mission_id, patron_id, serveur_id, status, replaced_engagement_id, contract_status, checked_in_at, checked_out_at, completed_at, cancelled_at, cancelled_reason, created_at, updated_at'
          )
          .eq('id', resolvedEngagementId)
          .maybeSingle()).data as Partial<EngagementRecord> | null)
      : null

    const normalizedExplicitEngagement = explicitEngagement
      ? ({
          id: String(explicitEngagement.id),
          mission_id: String(explicitEngagement.mission_id),
          patron_id: String(explicitEngagement.patron_id),
          serveur_id: String(explicitEngagement.serveur_id),
          status: explicitEngagement.status ?? null,
          replaced_engagement_id: explicitEngagement.replaced_engagement_id ?? null,
          contract_status: explicitEngagement.contract_status ?? null,
          checked_in_at: explicitEngagement.checked_in_at ?? null,
          checked_out_at: explicitEngagement.checked_out_at ?? null,
          completed_at: explicitEngagement.completed_at ?? null,
          cancelled_at: explicitEngagement.cancelled_at ?? null,
          cancelled_reason: explicitEngagement.cancelled_reason ?? null,
          created_at: explicitEngagement.created_at ?? null,
          updated_at: explicitEngagement.updated_at ?? null,
        } as EngagementRecord)
      : null

    const finalEngagement = normalizedExplicitEngagement ?? (await fetchLatestEngagementForMission(resolvedMissionId))
    const contract = finalEngagement ? await getContractForEngagement(finalEngagement.id) : null
    const workflow = await fetchMissionWorkflowSnapshot(resolvedMissionId)
    const evaluationMap = await fetchPatronMissionEvaluationMap(user.id, [resolvedMissionId])
    const evaluation = evaluationMap[resolvedMissionId] ?? { status: 'pending', note: null, evaluationId: null, createdAt: null }
    const etablissement = mission.etablissement_id ? await fetchEtablissementById(mission.etablissement_id) : null

    let serveurNom: string | null = null
    if (mission.serveur_id) {
      const { data: serveur } = await supabase
        .from('serveurs')
        .select('prenom, nom')
        .eq('id', mission.serveur_id)
        .maybeSingle()
      if (serveur) serveurNom = `${serveur.prenom ?? ''} ${serveur.nom ?? ''}`.trim()
    }

    setDetail({
      mission,
      serveurNom,
      etablissementNom: etablissement?.nom ?? null,
      engagement: finalEngagement,
      contract,
      workflow,
      evaluation,
    })
  }, [annonceId, contractId, engagementId, router])

  useFocusEffect(
    useCallback(() => {
      let mounted = true
      ;(async () => {
        try {
          await load()
        } finally {
          if (mounted) setLoading(false)
        }
      })()
      return () => {
        mounted = false
      }
    }, [load])
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  if (loading) {
    return (
      <View style={s.loadWrap}>
        <ActivityIndicator size="large" color={C.terra} />
      </View>
    )
  }

  if (!detail) {
    return (
      <View style={s.screen}>
        <View style={s.emptyWrap}>
          <Text style={s.emptyTitle}>Mission introuvable</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => router.back()} activeOpacity={0.85}>
            <Text style={s.primaryBtnTxt}>Retour</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  const summary = detail.workflow ? getMissionValidationSummary(detail.workflow) : null
  const ratingTone = getRatingTone(detail.evaluation.status)
  const infoMission = buildRows([
    { label: 'Poste', value: detail.mission.poste },
    { label: 'Date', value: detail.mission.date },
    { label: 'Horaires', value: `${detail.mission.heure_debut} - ${detail.mission.heure_fin}` },
    { label: 'Établissement', value: detail.etablissementNom ?? detail.mission.ville },
    { label: 'Tarif retenu', value: `${detail.mission.salaire}${EURO} / h brut` },
    { label: 'Serveur', value: detail.serveurNom ?? 'Non renseigné' },
  ])
  const statutsFinaux = buildRows([
    { label: 'Mission', value: summary?.missionStatusLabel ?? 'Terminée' },
    { label: 'Contrat', value: summary?.contractDisplayLabel ?? detail.contract?.status ?? 'Non disponible' },
    { label: 'DPAE', value: summary?.dpaeDone ? 'Confirmée' : 'À finaliser' },
    {
      label: 'Check-in',
      value: detail.workflow?.engagement_checked_in_at ?? detail.mission.checked_in_at ?? 'Non enregistré',
    },
    {
      label: 'Check-out',
      value: detail.workflow?.engagement_checked_out_at ?? detail.mission.checked_out_at ?? 'Non enregistré',
    },
  ])
  const contratRows = buildRows([
    { label: 'Engagement', value: detail.engagement?.id ?? null },
    { label: 'Contrat', value: detail.contract?.id ?? null },
    { label: 'Statut contrat', value: detail.contract?.status ?? detail.engagement?.contract_status ?? null },
  ])

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.terra} />}
      >
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={s.backTxt}>Retour</Text>
        </TouchableOpacity>

        <Text style={s.eyebrow}>DOSSIER MISSION</Text>
        <Text style={s.title}>{detail.mission.poste}</Text>
        <Text style={s.subtitle}>{detail.etablissementNom ?? detail.mission.ville}</Text>

        <View style={s.heroCard}>
          <View style={s.heroHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.heroTitle}>Mission terminée</Text>
              <Text style={s.heroText}>
                {"Retrouvez ici le récapitulatif final de la mission, les validations associées et l'état de l'évaluation."}
              </Text>
            </View>
            <View style={[s.pill, { backgroundColor: ratingTone.bg, borderColor: ratingTone.border }]}>
              <Text style={[s.pillTxt, { color: ratingTone.text }]}>{ratingTone.label}</Text>
            </View>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Infos mission</Text>
          <Text style={s.cardHint}>{"Les éléments clés de la mission telle qu'elle a été réalisée."}</Text>
          <View style={s.grid}>
            {infoMission.map((item) => (
              <View key={item.label} style={s.infoTile}>
                <Text style={s.infoTileLabel}>{item.label}</Text>
                <Text style={s.infoTileValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Statuts finaux</Text>
          <Text style={s.cardHint}>Vérifiez la clôture de mission, le contrat et les validations terrain.</Text>
          <View style={s.rows}>
            {statutsFinaux.map((item) => (
              <View key={item.label} style={s.row}>
                <Text style={s.rowLabel}>{item.label}</Text>
                <Text style={s.rowValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Contrat et DPAE</Text>
          <Text style={s.cardHint}>Documents et statuts associés à la mission finalisée.</Text>
          <View style={s.rows}>
            {contratRows.map((item) => (
              <View key={item.label} style={s.row}>
                <Text style={s.rowLabel}>{item.label}</Text>
                <Text style={s.rowValue}>{item.value}</Text>
              </View>
            ))}
            <View style={s.row}>
              <Text style={s.rowLabel}>DPAE</Text>
              <Text style={s.rowValue}>{summary?.dpaeDone ? 'Déclaration confirmée' : 'Déclaration à finaliser'}</Text>
            </View>
          </View>
        </View>

        <View style={[s.card, { backgroundColor: ratingTone.bg, borderColor: ratingTone.border }]}>
          <Text style={s.cardTitle}>Évaluation</Text>
          <Text style={[s.emphasis, { color: ratingTone.text }]}>{ratingTone.label}</Text>
          <Text style={s.cardHint}>
            {detail.evaluation.status === 'pending'
              ? "La mission reste dans votre historique, mais l'évaluation attend encore votre action."
              : "L'évaluation a bien été enregistrée pour cette mission."}
          </Text>
          {detail.evaluation.note != null ? <Text style={s.noteLine}>Note : {detail.evaluation.note} / 5</Text> : null}
        </View>

        {detail.engagement ? (
          <TouchableOpacity
            style={s.secondaryBtn}
            onPress={() =>
              router.push({
                pathname: '/contrat-engagement',
                params: { annonceId: detail.mission.id, engagementId: detail.engagement?.id ?? '' },
              })
            }
            activeOpacity={0.85}
          >
            <Text style={s.secondaryBtnTxt}>Voir le détail contrat</Text>
          </TouchableOpacity>
        ) : null}

        {detail.mission.serveur_id && detail.evaluation.status === 'pending' ? (
          <TouchableOpacity
            style={s.primaryBtn}
            onPress={() =>
              router.push({
                pathname: '/evaluer-serveur',
                params: {
                  annonceId: detail.mission.id,
                  serveurId: detail.mission.serveur_id,
                  serveurNom: detail.serveurNom ?? 'le serveur',
                },
              })
            }
            activeOpacity={0.85}
          >
            <Text style={s.primaryBtnTxt}>Évaluer le serveur</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { padding: 20, paddingTop: 56, paddingBottom: 40 },
  loadWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },
  backBtn: { marginBottom: 16, alignSelf: 'flex-start' },
  backTxt: { fontSize: 15, color: C.terra, fontWeight: '700' },
  eyebrow: { fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: C.muted, marginBottom: 6, fontWeight: '500' },
  title: { fontSize: 28, fontWeight: '800', color: C.title, marginBottom: 4 },
  subtitle: { fontSize: 14, color: C.soft, marginBottom: 18 },
  heroCard: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 18, marginBottom: 12 },
  heroHeader: { gap: 12 },
  heroTitle: { fontSize: 18, fontWeight: '800', color: C.title, marginBottom: 4 },
  heroText: { fontSize: 13, lineHeight: 19, color: C.softDark },
  pill: { alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  pillTxt: { fontSize: 12, fontWeight: '800' },
  card: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: C.title, marginBottom: 6 },
  cardHint: { fontSize: 12, color: C.soft, lineHeight: 18, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoTile: { width: '48%', backgroundColor: C.cardWarm, borderRadius: 14, borderWidth: 1, borderColor: C.borderSoft, padding: 12 },
  infoTileLabel: { fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700', marginBottom: 6 },
  infoTileValue: { fontSize: 14, color: C.title, fontWeight: '700', lineHeight: 19 },
  rows: { gap: 10 },
  row: { backgroundColor: C.cardWarm, borderRadius: 14, borderWidth: 1, borderColor: C.borderSoft, padding: 12 },
  rowLabel: { fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700', marginBottom: 4 },
  rowValue: { fontSize: 14, color: C.softDark, fontWeight: '700', lineHeight: 19 },
  emphasis: { fontSize: 15, fontWeight: '800', marginBottom: 6 },
  noteLine: { fontSize: 14, color: C.softDark, fontWeight: '700' },
  primaryBtn: {
    backgroundColor: C.terra,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.terraDark,
    marginTop: 4,
  },
  primaryBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryBtn: {
    backgroundColor: C.cardWarm,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.borderSoft,
    marginTop: 4,
  },
  secondaryBtnTxt: { color: C.softDark, fontSize: 14, fontWeight: '700' },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: C.title, marginBottom: 12 },
})
