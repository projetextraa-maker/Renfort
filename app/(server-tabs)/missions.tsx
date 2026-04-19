import { useFocusEffect, useRouter } from 'expo-router'
import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Dimensions, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { cancelConfirmedAnnonce, expireOpenAnnonces, selectServeurForMission, syncAnnoncesInProgress } from '../../lib/annonces'
import { ANNONCE_COMPAT_SELECT, ANNONCE_COMPAT_WITH_WORKFLOW_SELECT, normalizeAnnonceRecords } from '../../lib/annonce-read'
import { fetchContractMapForEngagements, getContractWarnings, type ContractRecord } from '../../lib/contracts'
import { EURO } from '../../lib/currency'
import { fetchEngagementMapForMissions } from '../../lib/engagements'
import { fetchEtablissementNameMapByIds } from '../../lib/etablissements'
import { getWorkerInterestLabel } from '../../lib/mission-hiring'
import { ACTIVE_MISSION_READ_STATUSES, hasMissionEnded, OPEN_MISSION_READ_STATUSES, shouldHideMissionFromOpenLists } from '../../lib/missions'
import { getCheckInBlockMessage, getCheckOutBlockMessage, getMissionValidationSummary, type MissionValidationSnapshot } from '../../lib/mission-validation'
import { getNearbyOffresForServeur, OffreProche } from '../../lib/offres'
import { getServerBusySlotMessage } from '../../lib/server-availability'
import { detectMissionSlot } from '../../lib/serveur-disponibilites'
import { supabase } from '../../lib/supabase'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const PERF_RIGHT_WIDTH = Math.floor((SCREEN_WIDTH - 32 - 10) * 0.35)
const C = { bg: '#F7F4EE', card: '#FFFFFF', cardSoft: '#F4EFE7', border: '#E6DED2', borderSoft: '#EFE7DB', title: '#171614', textSoft: '#6D675E', textMuted: '#9A9388', accent: '#2E8B57', accentSoft: '#E8F5ED', accentSoftBorder: '#CFE7D8', gold: '#B8893C', terra: '#C46A3C', terraBg: '#FEF3EB', terraBd: '#F5C9A9', red: '#C84B4B', redBg: '#FEF2F2', redBd: '#F2CACA' }

interface Serveur { id: string; prenom: string; nom: string; ville: string; disponible: boolean; score: number | null; missions_realisees: number | null; missions_acceptees: number | null; missions_annulees: number | null; rayon: number; lat: number | null; lng: number | null }
interface OffreRecue { demande_id: string; annonce_id: string; poste: string; etablissement_id?: string | null; ville: string; date: string; heure_debut: string; heure_fin: string; salaire: number; nom_restaurant: string }
interface MissionActive { id: string; poste: string; etablissement_id?: string | null; ville: string; date: string; heure_debut: string; heure_fin: string; salaire: number; statut: string; presence_confirmation_status?: string | null; contract_status?: string | null; payment_status?: string | null; check_in_status?: string | null; dpae_done?: boolean | null; checked_in_at?: string | null; checked_out_at?: string | null; engagement_status?: string | null; nom_restaurant: string }

const netEstime = (s: number) => Math.round(s * 0.75)
const posteInitiale = (p: string) => p?.slice(0, 2).toUpperCase() ?? '??'
function posteColor(p: string) { const l = p.toLowerCase(); if (l.includes('bar')) return '#C46A3C'; if (l.includes('chef') || l.includes('rang')) return '#2E8B57'; if (l.includes('runner')) return '#B8893C'; return '#9A9388' }
function formatDateFr(d: string) { try { return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) } catch { return d } }
const formatDistance = (km: number) => (km < 1 ? '< 1 km' : `${Math.round(km)} km`)
function tauxPresence(r: number, a: number, n: number) { void a; const total = r + n; if (total <= 0) return 100; return Math.max(0, Math.min(100, Math.round((r / total) * 100))) }
const tauxLabel = (t: number) => (t >= 95 ? 'Tres fiable' : t >= 80 ? 'Fiable' : 'En progression')
function getPresenceTone(t: number) { if (t >= 95) return { bg: '#E8F5ED', border: '#CFE7D8', text: C.accent }; if (t >= 80) return { bg: '#F7EEDC', border: '#E8D4AD', text: C.gold }; return { bg: '#F3EEE6', border: '#E5D8C7', text: '#8B6F47' } }
const initialesAvatar = (p: string, n: string) => `${p?.[0] ?? ''}${n?.[0] ?? ''}`.toUpperCase()
function buildMissionValidationSnapshot(mission: MissionActive): MissionValidationSnapshot { return { statut: mission.statut, presence_confirmation_status: mission.presence_confirmation_status ?? null, contract_status: mission.contract_status ?? null, payment_status: mission.payment_status ?? null, check_in_status: mission.check_in_status ?? null, dpae_done: mission.dpae_done ?? null, date: mission.date, heure_debut: mission.heure_debut, heure_fin: mission.heure_fin, engagement_status: mission.engagement_status ?? null, engagement_checked_in_at: mission.checked_in_at ?? null, engagement_checked_out_at: mission.checked_out_at ?? null } }
async function getCurrentUserId() { const { data: { user } } = await supabase.auth.getUser(); return user?.id ?? null }
async function getServeurById(id: string): Promise<Serveur | null> { const { data, error } = await supabase.from('serveurs').select('id, prenom, nom, ville, disponible, score, missions_realisees, missions_acceptees, missions_annulees, rayon, lat, lng').eq('id', id).single(); if (error || !data) return null; return data as Serveur }

export default function MissionsServeurScreen() {
  const router = useRouter()
  const [serveur, setServeur] = useState<Serveur | null>(null)
  const [annonces, setAnnonces] = useState<OffreProche[]>([])
  const [offresRecues, setOffresRecues] = useState<OffreRecue[]>([])
  const [missionsActives, setMissionsActives] = useState<MissionActive[]>([])
  const [contracts, setContracts] = useState<Record<string, ContractRecord>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [postulatingAnnonceId, setPostulatingAnnonceId] = useState<string | null>(null)
  const [expandedOpportunityId, setExpandedOpportunityId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const userId = await getCurrentUserId()
      if (!userId) { router.replace('/'); return }
      const srv = await getServeurById(userId)
      if (!srv) { router.replace('/'); return }
      setServeur(srv)
      setAnnonces(await getNearbyOffresForServeur(userId, undefined, 3))

      const { data: confirmedAnnonces } = await supabase.from('annonces').select(ANNONCE_COMPAT_WITH_WORKFLOW_SELECT).eq('serveur_id', userId).in('statut', [...ACTIVE_MISSION_READ_STATUSES]).order('date', { ascending: true }).order('heure_debut', { ascending: true })
      const normalizedConfirmedAnnonces = normalizeAnnonceRecords(confirmedAnnonces as any[])
      const progressedIds = normalizedConfirmedAnnonces.length > 0 ? await syncAnnoncesInProgress(normalizedConfirmedAnnonces as any[]) : []
      const normalized = normalizedConfirmedAnnonces.map((a: any) => progressedIds.includes(String(a.id)) ? { ...a, statut: 'in_progress' } : a).filter((a: any) => a?.patron_id && !hasMissionEnded(a.date, a.heure_debut, a.heure_fin))
      if (normalized.length > 0) {
        const { data: dpaeRows, error: dpaeError } = await supabase.from('annonces').select('id, dpae_done').in('id', normalized.map((a: any) => String(a.id)))
        const dpaeMap: Record<string, boolean | null> = {}
        if (!dpaeError) {
          ;(dpaeRows ?? []).forEach((row: any) => {
            dpaeMap[String(row.id)] = typeof row.dpae_done === 'boolean' ? row.dpae_done : null
          })
        }
        const engagementMap = await fetchEngagementMapForMissions(normalized.map((a: any) => String(a.id)))
        setContracts(await fetchContractMapForEngagements(Object.values(engagementMap).map((engagement) => engagement.id)))
        const patronIds = [...new Set(normalized.map((a: any) => a.patron_id))]
        const etablissementIds = [...new Set(normalized.map((a: any) => a.etablissement_id).filter(Boolean))]
        const { data: patronsData } = await supabase.from('patrons').select('id, nom_restaurant').in('id', patronIds)
        const etablissementMap = etablissementIds.length > 0 ? await fetchEtablissementNameMapByIds(etablissementIds as string[]) : {}
        const patronMap: Record<string, string> = {}
        ;(patronsData ?? []).forEach((p: any) => { patronMap[String(p.id)] = p.nom_restaurant ?? 'Restaurant' })
        setMissionsActives(normalized.map((a: any) => ({ id: a.id, poste: a.poste, etablissement_id: a.etablissement_id, ville: a.ville, date: a.date, heure_debut: a.heure_debut, heure_fin: a.heure_fin, salaire: a.salaire, statut: a.statut, presence_confirmation_status: a.presence_confirmation_status ?? null, contract_status: a.contract_status ?? null, payment_status: a.payment_status ?? null, check_in_status: a.check_in_status ?? null, dpae_done: Object.prototype.hasOwnProperty.call(dpaeMap, String(a.id)) ? dpaeMap[String(a.id)] : null, checked_in_at: a.checked_in_at ?? null, checked_out_at: a.checked_out_at ?? null, engagement_status: engagementMap[String(a.id)]?.status ?? null, nom_restaurant: (a.etablissement_id ? etablissementMap[String(a.etablissement_id)] : null) ?? patronMap[String(a.patron_id)] ?? 'Restaurant' })))
      } else { setMissionsActives([]); setContracts({}) }

      const { data: demandes } = await supabase.from('demandes').select('id, annonce_id').eq('serveur_id', userId).eq('initiateur', 'patron').eq('statut', 'en_attente')
      if ((demandes?.length ?? 0) > 0) {
        const safeDemandes = demandes ?? []
        const { data: annoncesData } = await supabase.from('annonces').select(ANNONCE_COMPAT_SELECT).in('id', safeDemandes.map((d: any) => d.annonce_id)).in('statut', [...OPEN_MISSION_READ_STATUSES])
        const normalizedOpenAnnonces = normalizeAnnonceRecords(annoncesData as any[])
        const expiredIds = normalizedOpenAnnonces.filter((a: any) => shouldHideMissionFromOpenLists(a.statut, a.date, a.heure_debut, a.heure_fin)).map((a: any) => a.id)
        if (expiredIds.length > 0) await expireOpenAnnonces(expiredIds)
        if (normalizedOpenAnnonces.length > 0) {
          const safeAnnonces = normalizedOpenAnnonces
          const patronIds = [...new Set(safeAnnonces.map((a: any) => a.patron_id))]
          const etablissementIds = [...new Set(safeAnnonces.map((a: any) => a.etablissement_id).filter(Boolean))]
          const { data: patronsData } = await supabase.from('patrons').select('id, nom_restaurant').in('id', patronIds)
          const etablissementMap = etablissementIds.length > 0 ? await fetchEtablissementNameMapByIds(etablissementIds as string[]) : {}
          const patronMap: Record<string, string> = {}; (patronsData ?? []).forEach((p: any) => { patronMap[p.id] = p.nom_restaurant })
          const annonceMap: Record<string, any> = {}; safeAnnonces.forEach((a: any) => { annonceMap[a.id] = a })
          const validDemandes = safeDemandes.filter((d: any) => { const a = annonceMap[d.annonce_id]; return Boolean(a && !shouldHideMissionFromOpenLists(a.statut, a.date, a.heure_debut, a.heure_fin) && a.poste && a.ville && a.date && a.heure_debut && a.heure_fin && a.salaire != null) })
          setOffresRecues(validDemandes.map((d: any) => { const a = annonceMap[d.annonce_id]; return { demande_id: d.id, annonce_id: d.annonce_id, poste: a.poste, etablissement_id: a.etablissement_id, ville: a.ville, date: a.date, heure_debut: a.heure_debut, heure_fin: a.heure_fin, salaire: a.salaire, nom_restaurant: (a.etablissement_id ? etablissementMap[a.etablissement_id] : null) ?? patronMap[a.patron_id] ?? 'Restaurant' } }))
        } else setOffresRecues([])
      } else setOffresRecues([])
    } catch (e) {
      console.error('dashboard fetchData error:', e)
    }
  }, [router])

  useEffect(() => { let mounted = true; (async () => { try { await fetchData() } finally { if (mounted) setLoading(false) } })(); return () => { mounted = false } }, [fetchData])
  useFocusEffect(useCallback(() => { fetchData() }, [fetchData]))
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchData(); setRefreshing(false) }, [fetchData])

  const accepterOffre = async (annonceId: string) => {
    Alert.alert('Confirmer', 'Confirmer votre disponibilite pour cette mission ?', [{ text: 'Annuler', style: 'cancel' }, { text: 'Confirmer ma disponibilite', onPress: async () => { const userId = await getCurrentUserId(); if (!userId) return; const result = await selectServeurForMission(annonceId, userId); if (!result.ok) { const targetOffre = offresRecues.find((offre) => offre.annonce_id === annonceId) ?? null; const busyMessage = targetOffre ? getServerBusySlotMessage(detectMissionSlot(targetOffre.heure_debut, targetOffre.heure_fin), 'self') : getServerBusySlotMessage(null, 'self'); Alert.alert('Information', result.reason === 'already_assigned' ? 'Cette mission a deja ete pourvue.' : result.reason === 'worker_unavailable' ? busyMessage : 'Impossible de confirmer votre disponibilite.'); return } fetchData() } }])
  }
  const refuserOffre = async (demandeId: string) => { await supabase.from('demandes').update({ statut: 'refusee' }).eq('id', demandeId); fetchData() }
  const annulerParticipation = async (annonceId: string) => {
    Alert.alert('Confirmer', 'Annuler votre participation ?', [{ text: 'Retour', style: 'cancel' }, { text: 'Annuler', style: 'destructive', onPress: async () => { const result = await cancelConfirmedAnnonce(annonceId, 'serveur'); if (!result.ok) { Alert.alert('Erreur', "Impossible d'annuler."); return } fetchData() } }])
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
      if (existing) { Alert.alert('Information', existing.initiateur === 'patron' ? 'Cette proposition attend deja votre reponse.' : 'Votre interet est deja enregistre.'); return }
      const { error } = await supabase.from('demandes').insert({ annonce_id: annonceId, serveur_id: userId, statut: 'en_attente', initiateur: 'serveur' })
      if (error) { Alert.alert('Erreur', "Impossible d'envoyer votre interet."); return }
      Alert.alert('Interet envoye', "L'etablissement a bien recu votre disponibilite.")
      await fetchData()
    } finally { setPostulatingAnnonceId(null) }
  }

  if (loading) return <View style={s.loadWrap}><StatusBar barStyle="dark-content" backgroundColor={C.bg} /><ActivityIndicator size="large" color={C.accent} /></View>
  if (!serveur) return null

  const initials = initialesAvatar(serveur.prenom ?? '', serveur.nom ?? '')
  const dispo = serveur.disponible ?? false
  const taux = tauxPresence(serveur.missions_realisees ?? 0, serveur.missions_acceptees ?? 0, serveur.missions_annulees ?? 0)
  const tone = getPresenceTone(taux)
  const nbProches = annonces?.length ?? 0

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}>
        <View style={s.header}>
          <View style={s.headerText}>
            <Text style={s.overline}>MISSIONS</Text>
            <Text style={s.name}>{serveur.prenom} <Text style={s.nameAccent}>{serveur.nom}</Text></Text>
            <Text style={s.headerSub}>Suivez vos propositions, vos interets envoyes et vos missions selectionnees.</Text>
          </View>
          <View style={s.avatar} pointerEvents="none">
            <Text style={s.avatarText}>{initials}</Text>
            <View style={[s.avatarDot, !dispo && s.avatarDotOff]} />
          </View>
        </View>

        <View style={s.statsRow}>
          <View style={s.statCard}><Text style={[s.statNum, { color: C.accent }]}>{nbProches}</Text><Text style={s.statLbl}>Opportunites</Text></View>
          <View style={s.statCard}><Text style={[s.statNum, { color: C.terra }]}>{offresRecues.length}</Text><Text style={s.statLbl}>Propositions</Text></View>
          <View style={s.statCard}><Text style={[s.statNum, { color: C.accent }]}>{missionsActives.length}</Text><Text style={s.statLbl}>En cours</Text></View>
        </View>

        {offresRecues.length > 0 && <>
          <View style={s.sectionHeader}><Text style={s.sectionTitle}>Missions proposees</Text><View style={s.sectionBadge}><Text style={s.sectionBadgeTxt}>{offresRecues.length}</Text></View></View>
          <View style={s.list}>{offresRecues.map((offre, i) => (
            <View key={offre.demande_id} style={[s.card, i < offresRecues.length - 1 && s.cardMb]}>
              <View style={s.cardTop}>
                <View style={[s.iconWrap, { backgroundColor: `${posteColor(offre.poste)}18` }]}><Text style={[s.iconTxt, { color: posteColor(offre.poste) }]}>{posteInitiale(offre.poste)}</Text></View>
                <View style={{ flex: 1 }}><Text style={s.cardPoste}>{offre.poste}</Text><Text style={s.cardResto}>{offre.nom_restaurant}</Text></View>
                <View style={s.badge}><Text style={s.badgeTxt}>{getWorkerInterestLabel({ statut: 'en_attente', initiateur: 'patron' }).toUpperCase()}</Text></View>
              </View>
              <View style={s.tags}>
                <View style={s.tag}><Text style={s.tagTxt}>{formatDateFr(offre.date)}</Text></View>
                <View style={s.tag}><Text style={s.tagTxt}>{offre.heure_debut} - {offre.heure_fin}</Text></View>
                <View style={s.tag}><Text style={s.tagTxt}>{offre.ville}</Text></View>
              </View>
              <View style={s.salaireRow}><Text style={s.salaire}>{`~${netEstime(offre.salaire)}${EURO}`}</Text><Text style={s.salaireLbl}> / h net est.</Text></View>
              <View style={s.actions}>
                <TouchableOpacity style={[s.btn, s.btnAccept]} onPress={() => accepterOffre(offre.annonce_id)} activeOpacity={0.85}><Text style={s.btnAcceptTxt}>Confirmer ma disponibilite</Text></TouchableOpacity>
                <TouchableOpacity style={[s.btn, s.btnRefus]} onPress={() => refuserOffre(offre.demande_id)} activeOpacity={0.85}><Text style={s.btnRefusTxt}>Refuser</Text></TouchableOpacity>
              </View>
            </View>
          ))}</View>
        </>}

        {missionsActives.length > 0 && <>
          <View style={s.sectionHeader}><Text style={s.sectionTitle}>{missionsActives.length > 1 ? 'Missions selectionnees' : 'Mission selectionnee'}</Text></View>
          <View style={s.list}>{missionsActives.map((mission, i) => (
            <View key={mission.id} style={[s.cardConfirmed, i < missionsActives.length - 1 && s.cardMb]}>
              {(() => {
                const validationSnapshot = buildMissionValidationSnapshot(mission)
                const engagementContract = Object.values(contracts).find((item) => item.mission_id === mission.id) ?? null
                const missionSummary = getMissionValidationSummary(validationSnapshot)
                const infoMessages = [
                  ...getContractWarnings(engagementContract, null),
                  getCheckInBlockMessage(validationSnapshot),
                  getCheckOutBlockMessage(validationSnapshot),
                ].filter(Boolean) as string[]
                return (
                  <>
              <View style={s.cardTop}>
                <View style={[s.iconWrap, { backgroundColor: `${posteColor(mission.poste)}18` }]}><Text style={[s.iconTxt, { color: posteColor(mission.poste) }]}>{posteInitiale(mission.poste)}</Text></View>
                <View style={{ flex: 1 }}><Text style={s.cardPoste}>{mission.poste}</Text><Text style={s.cardResto}>{mission.nom_restaurant}</Text></View>
                <View style={s.badgeConfirmed}><Text style={s.badgeConfirmedTxt}>{missionSummary.missionStatusLabel.toUpperCase()}</Text></View>
              </View>
              <View style={s.tags}>
                <View style={s.tag}><Text style={s.tagTxt}>{formatDateFr(mission.date)}</Text></View>
                <View style={s.tag}><Text style={s.tagTxt}>{mission.heure_debut} - {mission.heure_fin}</Text></View>
                <View style={s.tag}><Text style={s.tagTxt}>{mission.ville}</Text></View>
                <View style={s.tag}><Text style={s.tagTxt}>{missionSummary.contractDisplayLabel}</Text></View>
              </View>
              <View style={s.salaireRow}><Text style={s.salaire}>{`~${netEstime(mission.salaire)}${EURO}`}</Text><Text style={s.salaireLbl}> / h net est.</Text></View>
              {infoMessages.length > 0 ? <View style={s.infoBox}>{infoMessages.map((message) => <Text key={`${mission.id}-${message}`} style={s.infoText}>{message}</Text>)}</View> : null}
              <TouchableOpacity style={[s.btn, s.btnGhost, s.btnGhostFull]} onPress={() => voirContrat(mission.id, engagementContract?.engagement_id ?? null)} activeOpacity={0.85}><Text style={s.footerBtnGhostTxt}>{engagementContract?.status === 'signed' ? 'Voir le contrat' : 'Voir / signer le contrat'}</Text></TouchableOpacity>
              <TouchableOpacity style={[s.btn, s.btnGhost, s.btnGhostFull]} onPress={() => annulerParticipation(mission.id)} activeOpacity={0.85}><Text style={s.btnRefusTxt}>Annuler ma participation</Text></TouchableOpacity>
                  </>
                )
              })()}
            </View>
          ))}</View>
        </>}

        <View style={s.sectionHeader}><Text style={s.sectionTitle}>Opportunites autour de vous</Text><TouchableOpacity onPress={() => router.push('/missions-disponibles')}><Text style={s.sectionLink}>Tout voir</Text></TouchableOpacity></View>

        {annonces.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>Aucune mission pour l&apos;instant</Text>
            <Text style={s.emptySub}>{dispo ? `Elargissez votre rayon au-dela de ${serveur.rayon ?? 0} km` : 'Activez vos disponibilites dans l onglet Disponibilites'}</Text>
            {!dispo && <TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/(server-tabs)/disponibilites')} activeOpacity={0.9}><Text style={s.emptyBtnTxt}>Configurer mes disponibilites</Text></TouchableOpacity>}
          </View>
        ) : (
          <View style={s.list}>{annonces.map((annonce, i) => (
            <View key={annonce.id} style={[s.missionCard, i < annonces.length - 1 && s.cardMb]}>
              <View style={s.missionRow}>
                <View style={[s.missionIcon, { backgroundColor: `${posteColor(annonce.poste)}18` }]}><Text style={[s.missionIconTxt, { color: posteColor(annonce.poste) }]}>{posteInitiale(annonce.poste)}</Text></View>
                <View style={s.missionBody}>
                  <Text style={s.missionPoste} numberOfLines={1}>{annonce.poste}</Text>
                  {annonce.nom_restaurant ? <Text style={s.missionResto}>{annonce.nom_restaurant}</Text> : null}
                  <View style={s.metaRow}>
                    <View style={s.metaPill}><Text style={s.metaTxt}>{annonce.ville} - {formatDistance(annonce.distanceKm)}</Text></View>
                    <View style={s.metaPill}><Text style={s.metaTxt}>{formatDateFr(annonce.date)}</Text></View>
                  </View>
                  <Text style={s.missionHours}>{annonce.heure_debut} - {annonce.heure_fin}</Text>
                </View>
                <View style={s.missionRight}><Text style={s.missionPrice}>{`~${netEstime(annonce.salaire)}${EURO}`}</Text><Text style={s.missionPriceHint}>/ h net</Text></View>
              </View>
              {expandedOpportunityId === annonce.id ? (
                <View style={s.missionFooter}>
                  <TouchableOpacity style={[s.footerBtn, s.footerBtnGhost]} onPress={() => setExpandedOpportunityId(null)} activeOpacity={0.85}><Text style={s.footerBtnGhostTxt}>Fermer</Text></TouchableOpacity>
                  <TouchableOpacity style={[s.footerBtn, s.footerBtnPrimary, postulatingAnnonceId === annonce.id && s.footerBtnDisabled]} disabled={postulatingAnnonceId === annonce.id} onPress={() => postulerOpportunite(annonce.id)} activeOpacity={0.85}><Text style={s.footerBtnPrimaryTxt}>{postulatingAnnonceId === annonce.id ? 'Envoi...' : 'Je suis interesse'}</Text></TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={[s.footerBtn, s.footerBtnGhost, s.footerBtnSingle]} onPress={() => setExpandedOpportunityId(annonce.id)} activeOpacity={0.85}><Text style={s.footerBtnGhostTxt}>Voir</Text></TouchableOpacity>
              )}
            </View>
          ))}</View>
        )}

        <View style={s.sectionHeader}><Text style={s.sectionTitle}>Votre activite</Text></View>
        <View style={s.perfGrid}>
          <View style={s.perfMain}>
            <Text style={s.perfEyebrow}>Fiabilite</Text>
            <Text style={s.perfBig}>{taux}%</Text>
            <View style={[s.perfBadge, { backgroundColor: tone.bg, borderColor: tone.border }]}><Text style={[s.perfBadgeTxt, { color: tone.text }]}>{tauxLabel(taux)}</Text></View>
            <View style={s.progressTrack}><View style={[s.progressFill, { width: `${taux}%` as any }]} /></View>
          </View>
          <View style={s.perfSide}>
            <View style={s.perfSmall}><Text style={s.perfSmallIcon}>★</Text><Text style={s.perfSmallVal}>{serveur.score != null ? serveur.score.toFixed(1) : '-'}</Text><Text style={s.perfSmallLbl}>Note</Text></View>
            <View style={[s.perfSmall, s.perfSmallSpacing]}><Text style={s.perfSmallIcon}>M</Text><Text style={s.perfSmallVal}>{serveur.missions_realisees ?? 0}</Text><Text style={s.perfSmallLbl}>Realisees</Text></View>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg }, loadWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg }, scroll: { flex: 1 }, content: { paddingBottom: 120 },
  header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, headerText: { flex: 1, paddingRight: 12 }, overline: { fontSize: 11, color: C.textMuted, marginBottom: 8, fontWeight: '800', letterSpacing: 1.1 }, name: { fontSize: 30, fontWeight: '800', color: C.title, letterSpacing: -0.8, lineHeight: 34 }, nameAccent: { color: C.accent }, headerSub: { fontSize: 13, color: C.textSoft, marginTop: 8, lineHeight: 19, maxWidth: 260 },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6, elevation: 1 }, avatarText: { fontSize: 16, fontWeight: '700', color: C.title }, avatarDot: { position: 'absolute', bottom: 1, right: 1, width: 11, height: 11, borderRadius: 6, backgroundColor: C.accent, borderWidth: 2, borderColor: C.card }, avatarDotOff: { backgroundColor: C.textMuted },
  statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 6 }, statCard: { flex: 1, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, paddingVertical: 12, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.03, shadowOffset: { width: 0, height: 2 }, shadowRadius: 5, elevation: 1 }, statNum: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginBottom: 2 }, statLbl: { fontSize: 10, color: C.textMuted, fontWeight: '700', textAlign: 'center' },
  sectionHeader: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { fontSize: 19, fontWeight: '800', color: C.title, letterSpacing: -0.35 }, sectionLink: { fontSize: 13, color: C.textSoft, fontWeight: '700' }, sectionBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.terra, alignItems: 'center', justifyContent: 'center' }, sectionBadgeTxt: { fontSize: 10, fontWeight: '800', color: '#fff' },
  list: { paddingHorizontal: 16 }, card: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 15, shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 3 }, shadowRadius: 8, elevation: 1 }, cardConfirmed: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.accentSoftBorder, padding: 15, shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 3 }, shadowRadius: 8, elevation: 1 }, cardMb: { marginBottom: 10 }, cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 10 }, iconTxt: { fontSize: 13, fontWeight: '800' }, cardPoste: { fontSize: 15, fontWeight: '700', color: C.title }, cardResto: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  badge: { backgroundColor: C.terraBg, borderWidth: 1, borderColor: C.terraBd, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }, badgeTxt: { fontSize: 9, fontWeight: '700', color: C.terra, letterSpacing: 0.4 }, badgeConfirmed: { backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentSoftBorder, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }, badgeConfirmedTxt: { fontSize: 9, fontWeight: '700', color: C.accent, letterSpacing: 0.4 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }, tag: { backgroundColor: C.cardSoft, borderWidth: 1, borderColor: C.borderSoft, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 }, tagTxt: { fontSize: 11, color: C.textSoft, fontWeight: '500' }, salaireRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 2 }, salaire: { fontSize: 22, fontWeight: '800', color: C.title, letterSpacing: -0.5 }, salaireLbl: { fontSize: 12, color: C.textMuted },
  infoBox: { marginTop: 10, marginBottom: 8, backgroundColor: C.cardSoft, borderWidth: 1, borderColor: C.borderSoft, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }, infoText: { fontSize: 12, color: C.textSoft, lineHeight: 18, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 }, btn: { borderRadius: 11, paddingVertical: 12, alignItems: 'center', borderWidth: 1 }, btnAccept: { flex: 1, backgroundColor: C.accent, borderColor: C.accent }, btnAcceptTxt: { fontSize: 13, fontWeight: '700', color: '#fff' }, btnRefus: { paddingHorizontal: 16, backgroundColor: C.redBg, borderColor: C.redBd }, btnRefusTxt: { fontSize: 13, fontWeight: '700', color: C.red }, btnGhost: { backgroundColor: C.cardSoft, borderColor: C.borderSoft }, btnGhostFull: { marginTop: 8, width: '100%' },
  missionCard: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 13, shadowColor: '#000', shadowOpacity: 0.035, shadowOffset: { width: 0, height: 3 }, shadowRadius: 8, elevation: 1 }, missionRow: { flexDirection: 'row', alignItems: 'center' }, missionIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12, flexShrink: 0 }, missionIconTxt: { fontSize: 13, fontWeight: '800' }, missionBody: { flex: 1, minWidth: 0 }, missionPoste: { fontSize: 15, fontWeight: '700', color: C.title },
  missionResto: { fontSize: 12, color: C.textMuted, marginTop: 3 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 }, metaPill: { backgroundColor: C.cardSoft, borderWidth: 1, borderColor: C.borderSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, marginRight: 5, marginBottom: 5 }, metaTxt: { fontSize: 10, color: C.textSoft, fontWeight: '600' }, missionHours: { fontSize: 12, color: C.textMuted, marginTop: 2 }, missionRight: { alignItems: 'flex-end', marginLeft: 8, flexShrink: 0 }, missionPrice: { fontSize: 15, fontWeight: '800', color: C.title, marginBottom: 2 }, missionPriceHint: { fontSize: 10, color: C.textMuted },
  missionFooter: { flexDirection: 'row', gap: 8, marginTop: 12 }, footerBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1 }, footerBtnSingle: { marginTop: 12 }, footerBtnGhost: { backgroundColor: C.cardSoft, borderColor: C.borderSoft }, footerBtnGhostTxt: { fontSize: 13, fontWeight: '700', color: C.textSoft }, footerBtnPrimary: { backgroundColor: C.accent, borderColor: C.accent }, footerBtnPrimaryTxt: { fontSize: 13, fontWeight: '700', color: '#fff' }, footerBtnDisabled: { opacity: 0.6 },
  emptyCard: { marginHorizontal: 16, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.border, paddingHorizontal: 18, paddingVertical: 18, alignItems: 'center' }, emptyTitle: { fontSize: 15, fontWeight: '800', color: C.title, textAlign: 'center', marginBottom: 6 }, emptySub: { fontSize: 12, color: C.textSoft, textAlign: 'center', lineHeight: 18 }, emptyBtn: { marginTop: 14, backgroundColor: C.accent, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12 }, emptyBtnTxt: { fontSize: 13, fontWeight: '700', color: '#fff' },
  perfGrid: { marginHorizontal: 16, flexDirection: 'row', marginBottom: 12 }, perfMain: { flex: 1, backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 16, marginRight: 10 }, perfEyebrow: { fontSize: 10, color: C.textMuted, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }, perfBig: { fontSize: 34, fontWeight: '800', color: C.title, letterSpacing: -1, lineHeight: 38 }, perfBadge: { alignSelf: 'flex-start', borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, marginTop: 7, marginBottom: 12 }, perfBadgeTxt: { fontSize: 11, fontWeight: '700' }, progressTrack: { height: 6, backgroundColor: '#EDE3D7', borderRadius: 999, overflow: 'hidden' }, progressFill: { height: 6, backgroundColor: C.accent, borderRadius: 999 },
  perfSide: { width: PERF_RIGHT_WIDTH }, perfSmall: { flex: 1, backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 12 }, perfSmallSpacing: { marginTop: 10 }, perfSmallIcon: { fontSize: 14, marginBottom: 6 }, perfSmallVal: { fontSize: 21, fontWeight: '800', color: C.title, letterSpacing: -0.5 }, perfSmallLbl: { marginTop: 3, fontSize: 10, color: C.textSoft, fontWeight: '700' },
})
