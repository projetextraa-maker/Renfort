import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import {
  createDraftContractForEngagement,
  getContractForEngagement,
  getContractWarnings,
  signContractAsPatron,
  signContractAsWorker,
  type ContractRecord,
} from '../lib/contracts'
import { fetchMissionWorkflowSnapshot, markMissionDpaeDone } from '../lib/annonces'
import { fetchActiveEngagementForMission, type EngagementRecord } from '../lib/engagements'
import { getMissionValidationSummary, type MissionValidationSnapshot } from '../lib/mission-validation'
import { supabase } from '../lib/supabase'

const C = {
  bg: '#F7F4EE',
  card: '#FFFFFF',
  cardSoft: '#FCF8F2',
  border: '#E8DED1',
  borderSoft: '#F1E8DD',
  title: '#171614',
  text: '#2A2723',
  textSoft: '#6D675E',
  textMuted: '#9A9388',
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
}

type ActorRole = 'patron' | 'worker' | 'viewer'

export default function ContratEngagementScreen() {
  const router = useRouter()
  const { engagementId, annonceId } = useLocalSearchParams()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [signing, setSigning] = useState(false)
  const [engagement, setEngagement] = useState<EngagementRecord | null>(null)
  const [contract, setContract] = useState<ContractRecord | null>(null)
  const [missionValidation, setMissionValidation] = useState<MissionValidationSnapshot | null>(null)
  const [actorRole, setActorRole] = useState<ActorRole>('viewer')
  const [schemaMessage, setSchemaMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const fallbackMissionId = typeof annonceId === 'string' ? annonceId : null
    const resolvedEngagementId = typeof engagementId === 'string' ? engagementId : null

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      router.replace('/')
      return
    }

    let activeEngagement: EngagementRecord | null = null
    if (resolvedEngagementId) {
      const contractEngagement = await fetchActiveEngagementForMission(fallbackMissionId ?? '')
      if (contractEngagement?.id === resolvedEngagementId) {
        activeEngagement = contractEngagement
      } else if (fallbackMissionId) {
        activeEngagement = await fetchActiveEngagementForMission(fallbackMissionId)
      }
    } else if (fallbackMissionId) {
      activeEngagement = await fetchActiveEngagementForMission(fallbackMissionId)
    }

    if (!activeEngagement && fallbackMissionId) {
      activeEngagement = await fetchActiveEngagementForMission(fallbackMissionId)
    }

    setEngagement(activeEngagement ?? null)

    if (!activeEngagement) {
      setContract(null)
      setMissionValidation(null)
      setActorRole('viewer')
      setSchemaMessage(null)
      return
    }

    if (user.id === activeEngagement.patron_id) setActorRole('patron')
    else if (user.id === activeEngagement.serveur_id) setActorRole('worker')
    else setActorRole('viewer')

    const existingContract = await getContractForEngagement(activeEngagement.id)
    if (existingContract) {
      setContract(existingContract)
      setMissionValidation(await fetchMissionWorkflowSnapshot(activeEngagement.mission_id))
      setSchemaMessage(null)
      return
    }

    const created = await createDraftContractForEngagement(activeEngagement.id)
    if (created.ok) {
      setContract(created.contract)
      setMissionValidation(await fetchMissionWorkflowSnapshot(activeEngagement.mission_id))
      setSchemaMessage(null)
      return
    }

    if (created.reason === 'schema_unavailable') {
      setSchemaMessage(created.message)
      setContract(null)
      return
    }

    setSchemaMessage(created.message)
    setContract(null)
  }, [annonceId, engagementId, router])

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

  const handleSign = useCallback(async () => {
    if (!engagement || actorRole === 'viewer' || signing) return
    setSigning(true)
    try {
      const result =
        actorRole === 'patron'
          ? await signContractAsPatron(engagement.id)
          : await signContractAsWorker(engagement.id)

      if (!result.ok) {
        Alert.alert('Signature impossible', result.message)
        return
      }

      setContract(result.contract)
      setMissionValidation(await fetchMissionWorkflowSnapshot(engagement.mission_id))
      Alert.alert('Signature enregistrée', actorRole === 'patron' ? 'Votre signature a bien été enregistrée.' : 'Votre signature a bien été enregistrée.')
    } finally {
      setSigning(false)
    }
  }, [actorRole, engagement, signing])

  const handleMarkDpaeDone = useCallback(async () => {
    if (!engagement || actorRole !== 'patron') return

    const result = await markMissionDpaeDone(engagement.mission_id)
    if (!result.ok) {
      Alert.alert('Action bloquée', result.message ?? "Impossible d'enregistrer la DPAE.")
      return
    }

    setMissionValidation(await fetchMissionWorkflowSnapshot(engagement.mission_id))
    Alert.alert('DPAE enregistrée', 'La déclaration URSSAF est maintenant marquée comme finalisée pour cette mission.')
  }, [actorRole, engagement])

  if (loading) {
    return (
      <View style={s.loadWrap}>
        <ActivityIndicator size="large" color={C.terra} />
      </View>
    )
  }

  const warnings = getContractWarnings(contract, engagement)
  const missionSummary = missionValidation ? getMissionValidationSummary(missionValidation) : null
  const missionAgreementBlockers = missionSummary?.contractualizationBlockers ?? []
  const missionAdministrativeBlockers = missionSummary?.administrativeBlockers ?? []
  const presenceMessage = missionSummary?.presenceMessage ?? null
  const payload = contract?.payload_snapshot
  const canSignAsPatron = actorRole === 'patron' && !contract?.patron_signed_at && contract?.status !== 'signed' && contract?.status !== 'cancelled'
  const canSignAsWorker = actorRole === 'worker' && !contract?.worker_signed_at && contract?.status !== 'signed' && contract?.status !== 'cancelled'
  const canSign = Boolean(canSignAsPatron || canSignAsWorker)
  const canMarkDpae = actorRole === 'patron' && Boolean(engagement) && missionSummary?.isAgreementConfirmed && !missionSummary?.dpaeDone

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

        <View style={s.card}>
          <Text style={s.eyebrow}>CONTRAT</Text>
          <Text style={s.title}>Contrat pré-rempli</Text>
          <Text style={s.sub}>
            {"Le contrat reste entre l'établissement employeur et le serveur sélectionné. La plateforme prépare seulement le support."}
          </Text>
        </View>

        {schemaMessage ? (
          <View style={[s.card, s.warnCard]}>
            <Text style={s.warnTitle}>Configuration requise</Text>
            <Text style={s.warnText}>{schemaMessage}</Text>
            <Text style={s.warnText}>{"Le contrat n'est pas encore disponible pour cette mission. Réessayez dans un instant."}</Text>
          </View>
        ) : null}

        {engagement ? (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Engagement rattache</Text>
            <Text style={s.rowLabel}>Statut mission</Text>
            <Text style={s.rowValue}>{missionSummary?.missionStatusLabel ?? 'Mission confirmée'}</Text>
            <Text style={s.rowLabel}>Contrat</Text>
            <Text style={s.rowValue}>{missionSummary?.contractDisplayLabel ?? 'En cours'}</Text>
            {missionSummary?.missionStatusValue !== 'pending' ? (
              <>
                <Text style={s.rowLabel}>Engagement</Text>
                <Text style={s.rowValue}>{engagement.status}</Text>
              </>
            ) : null}
          </View>
        ) : (
          <View style={[s.card, s.warnCard]}>
            <Text style={s.warnTitle}>Aucun engagement</Text>
            <Text style={s.warnText}>Le contrat ne peut pas être généré sans engagement actif sur cette mission.</Text>
          </View>
        )}

        {missionSummary ? (
          <View style={s.card}>
            <Text style={s.sectionTitle}>État mission</Text>
            <Text style={s.rowLabel}>Statut mission</Text>
            <Text style={s.rowValue}>{missionSummary.missionStatusLabel}</Text>
            <Text style={s.rowLabel}>Accord mission</Text>
            <Text style={s.rowValue}>
              {missionSummary.isAgreementConfirmed ? 'Engagement confirmé' : 'En attente de validation'}
            </Text>
            {missionAgreementBlockers.length > 0 ? (
              <View style={s.inlineWarnBox}>
                {missionAgreementBlockers.map((blocker, index) => (
                  <Text key={`${blocker}-${index}`} style={s.inlineWarnText}>{blocker}</Text>
                ))}
              </View>
            ) : (
              <View style={s.inlineGoodBox}>
                <Text style={s.inlineGoodText}>
                  L&apos;accord mission entre le patron et le serveur est bien confirmé.
                </Text>
              </View>
            )}

            <Text style={s.rowLabel}>Administratif</Text>
            <Text style={s.rowValue}>
              {missionSummary.isReadyForCheckIn ? 'Prêt pour le démarrage' : 'À finaliser si nécessaire'}
            </Text>
            {missionAdministrativeBlockers.length > 0 ? (
              <View style={s.inlineWarnBox}>
                {missionAdministrativeBlockers.map((blocker, index) => (
                  <Text key={`${blocker}-${index}`} style={s.inlineWarnText}>{blocker}</Text>
                ))}
              </View>
            ) : null}

            <Text style={s.rowLabel}>Reconfirmation présence</Text>
            <Text style={s.rowValue}>
              {missionSummary.isPresenceConfirmed ? 'Disponibilité reconfirmée' : 'À sécuriser avant la prise de poste'}
            </Text>
            {presenceMessage ? <Text style={s.presenceText}>{presenceMessage}</Text> : null}
          </View>
        ) : null}

        {warnings.length > 0 ? (
          <View style={[s.card, s.warnCard]}>
            <Text style={s.warnTitle}>Points à vérifier</Text>
            {warnings.map((warning, index) => (
              <Text key={`${warning}-${index}`} style={s.warnText}>{warning}</Text>
            ))}
          </View>
        ) : null}

        {payload ? (
          <>
            <View style={s.card}>
              <Text style={s.sectionTitle}>Mission</Text>
              <Text style={s.rowLabel}>Poste</Text>
              <Text style={s.rowValue}>{payload.mission.poste}</Text>
              <Text style={s.rowLabel}>Date</Text>
              <Text style={s.rowValue}>{payload.mission.date ?? '-'}</Text>
              <Text style={s.rowLabel}>Horaires</Text>
              <Text style={s.rowValue}>{`${payload.mission.heure_debut ?? '-'} - ${payload.mission.heure_fin ?? '-'}`}</Text>
              <Text style={s.rowLabel}>Salaire brut</Text>
              <Text style={s.rowValue}>{payload.mission.salaire_brut_horaire != null ? `${payload.mission.salaire_brut_horaire}€/h` : '-'}</Text>
            </View>

            <View style={s.card}>
              <Text style={s.sectionTitle}>Employeur</Text>
              <Text style={s.rowLabel}>Établissement</Text>
              <Text style={s.rowValue}>{payload.etablissement.nom ?? payload.patron.nom_restaurant ?? '-'}</Text>
              <Text style={s.rowLabel}>Adresse</Text>
              <Text style={s.rowValue}>{payload.etablissement.adresse ?? payload.etablissement.ville ?? '-'}</Text>
              <Text style={s.rowLabel}>Contact patron</Text>
              <Text style={s.rowValue}>{payload.patron.email ?? payload.patron.telephone ?? '-'}</Text>
            </View>

            <View style={s.card}>
              <Text style={s.sectionTitle}>Serveur</Text>
              <Text style={s.rowLabel}>Identité</Text>
              <Text style={s.rowValue}>{`${payload.worker.prenom ?? ''} ${payload.worker.nom ?? ''}`.trim() || '-'}</Text>
              <Text style={s.rowLabel}>Contact</Text>
              <Text style={s.rowValue}>{payload.worker.email ?? payload.worker.telephone ?? '-'}</Text>
            </View>

            <View style={s.card}>
              <Text style={s.sectionTitle}>Cadre juridique</Text>
              <Text style={s.legalText}>{payload.legal.employer_label}</Text>
              <Text style={s.legalSub}>{payload.legal.platform_role}</Text>
            </View>
          </>
        ) : null}

        {contract ? (
          <View style={s.card}>
            <Text style={s.sectionTitle}>Signatures</Text>
            <Text style={s.rowLabel}>Patron</Text>
            <Text style={s.rowValue}>{contract.patron_signed_at ? `Signé le ${new Date(contract.patron_signed_at).toLocaleString('fr-FR')}` : 'En attente'}</Text>
            <Text style={s.rowLabel}>Serveur</Text>
            <Text style={s.rowValue}>{contract.worker_signed_at ? `Signé le ${new Date(contract.worker_signed_at).toLocaleString('fr-FR')}` : 'En attente'}</Text>
          </View>
        ) : null}

        {canMarkDpae ? (
          <TouchableOpacity style={s.secondaryBtn} onPress={handleMarkDpaeDone} activeOpacity={0.88}>
            <Text style={s.secondaryBtnTxt}>Marquer la DPAE comme faite</Text>
          </TouchableOpacity>
        ) : null}

        {canSign ? (
          <TouchableOpacity style={[s.primaryBtn, signing && s.primaryBtnDisabled]} onPress={handleSign} disabled={signing} activeOpacity={0.88}>
            <Text style={s.primaryBtnTxt}>{signing ? 'Signature...' : actorRole === 'patron' ? 'Signer en tant que patron' : 'Signer en tant que serveur'}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 36 },
  loadWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },
  backBtn: { paddingTop: 56, marginBottom: 16, alignSelf: 'flex-start' },
  backTxt: { fontSize: 15, color: C.terra, fontWeight: '700' },
  card: { backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.border, padding: 18, marginBottom: 12 },
  warnCard: { backgroundColor: C.redBg, borderColor: C.redBd },
  eyebrow: { fontSize: 10, fontWeight: '700', color: C.textMuted, letterSpacing: 1.2, marginBottom: 6 },
  title: { fontSize: 28, fontWeight: '800', color: C.title, letterSpacing: -0.4 },
  sub: { marginTop: 8, fontSize: 14, color: C.textSoft, lineHeight: 21 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: C.title, marginBottom: 12 },
  rowLabel: { fontSize: 11, fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', marginTop: 8, marginBottom: 3 },
  rowValue: { fontSize: 14, color: C.text, fontWeight: '600' },
  warnTitle: { fontSize: 13, fontWeight: '800', color: C.red, marginBottom: 8, textTransform: 'uppercase' },
  warnText: { fontSize: 13, color: C.red, lineHeight: 20, marginBottom: 4 },
  inlineWarnBox: { marginTop: 10, backgroundColor: C.terraBg, borderWidth: 1, borderColor: C.terraBd, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  inlineWarnText: { fontSize: 13, color: C.terraDark, lineHeight: 20, marginBottom: 3, fontWeight: '600' },
  inlineGoodBox: { marginTop: 10, backgroundColor: C.greenBg, borderWidth: 1, borderColor: C.greenBd, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  inlineGoodText: { fontSize: 13, color: C.green, lineHeight: 20, fontWeight: '700' },
  presenceText: { marginTop: 6, fontSize: 13, color: C.textSoft, lineHeight: 20 },
  legalText: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 6 },
  legalSub: { fontSize: 13, color: C.textSoft, lineHeight: 20 },
  primaryBtn: { backgroundColor: C.terra, borderRadius: 18, paddingVertical: 16, alignItems: 'center', marginBottom: 14, borderWidth: 1, borderColor: C.terraDark },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnTxt: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  secondaryBtn: { backgroundColor: C.cardSoft, borderRadius: 18, paddingVertical: 15, alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: C.borderSoft },
  secondaryBtnTxt: { fontSize: 15, fontWeight: '800', color: C.textSoft },
})
