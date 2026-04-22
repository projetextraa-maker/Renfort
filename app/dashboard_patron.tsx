import { useFocusEffect, useRouter } from 'expo-router'
import React, { useCallback, useRef, useState } from 'react'
import {
  Alert,
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
import { ANNONCE_COMPAT_SELECT, normalizeAnnonceRecords, type NormalizedAnnonceRecord } from '../lib/annonce-read'
import { cancelConfirmedAnnonce, closeDemandesForAnnonce, expireOpenAnnonces, selectServeurForMission, syncAnnoncesInProgress, updateAnnonceLifecycleStatus } from '../lib/annonces'
import { getMissionEngagementStage } from '../lib/mission-hiring'
import { EURO } from '../lib/currency'
import { fetchEtablissementNameMapByIds, fetchEtablissementsForPatron } from '../lib/etablissements'
import { saveEvaluation } from '../lib/evaluations'
import { isActiveMissionStatus, isOpenMissionStatus, isCompletedMissionStatus as isResolvedMissionStatus, normalizeMissionStatus, shouldHideMissionFromOpenLists } from '../lib/missions'
import { syncReferralRewardsForReferredUser } from '../lib/referrals'
import { getServerBusySlotMessage } from '../lib/server-availability'
import { detectMissionSlot } from '../lib/serveur-disponibilites'
import { syncServeurMissionStats } from '../lib/serveur-stats'
import { supabase } from '../lib/supabase'

type Annonce = Pick<
  NormalizedAnnonceRecord,
  'id' | 'poste' | 'date' | 'heure_debut' | 'heure_fin' | 'salaire' | 'ville' | 'statut' | 'serveur_id' | 'note' | 'etablissement_id'
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

type RatingModalState = {
  annonceId: string
  serveurId: string
  serveurNom: string
} | null

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
  terra:     '#C46A3C',
  terraDark: '#9F542D',
  terraBg:   '#FEF3EB',
  terraBd:   '#F5C9A9',
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
    case 'confirmed': return { label: 'Selectionnee', bg: C.greenBg, color: C.green, border: C.greenBd }
    case 'in_progress': return { label: 'En cours', bg: C.greenBg, color: C.green, border: C.greenBd }
    case 'completed': return { label: 'Terminee', bg: '#F5F3F0', color: '#888', border: '#E0D9D0' }
    case 'no_show': return { label: 'Serveur absent', bg: C.redBg, color: C.red, border: C.redBd }
    case 'cancelled_by_patron': return { label: 'Annulee par vous', bg: C.redBg, color: C.red, border: C.redBd }
    case 'cancelled_by_server': return { label: 'Annulee par le serveur', bg: C.redBg, color: C.red, border: C.redBd }
    case 'expired': return { label: 'Expiree', bg: C.redBg, color: C.red, border: C.redBd }
    default: return { label: statut, bg: '#F5F3F0', color: '#888', border: '#E0D9D0' }
  }
}

function isPendingMissionStatus(statut: string | null | undefined) {
  return isOpenMissionStatus(statut)
}

function isAssignedMissionStatus(statut: string | null | undefined) {
  return isActiveMissionStatus(statut)
}

function isCompletedMissionStatus(statut: string | null | undefined) {
  return isResolvedMissionStatus(statut)
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

  const lowRatingReasons = ['retard', 'absence', 'attitude', 'niveau insuffisant']

  const chargerDonnees = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }

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

      const { data, error } = await supabase
        .from('annonces').select(ANNONCE_COMPAT_SELECT).eq('patron_id', user.id)
        .order('created_at', { ascending: false })

      if (!error && data) {
        const normalizedRows = normalizeAnnonceRecords(data as any[])
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
          let candidatures: any[] | null = null
          const { data: candidaturesWithReplacement, error: candidaturesError } = await supabase
            .from('demandes')
            .select('annonce_id, serveur_id, replacement_for_engagement_id')
            .eq('statut', 'en_attente')
            .eq('initiateur', 'serveur')
            .in('annonce_id', annonceIds)

          if (candidaturesError && String(candidaturesError.message ?? '').includes('replacement_for_engagement_id')) {
            console.warn('dashboard_patron: fallback candidatures query without replacement_for_engagement_id', candidaturesError.message)
            const { data: legacyCandidatures, error: legacyCandidaturesError } = await supabase
              .from('demandes')
              .select('annonce_id, serveur_id')
              .eq('statut', 'en_attente')
              .eq('initiateur', 'serveur')
              .in('annonce_id', annonceIds)

            if (legacyCandidaturesError) {
              console.error('dashboard_patron: candidatures fallback error', legacyCandidaturesError)
            } else {
              candidatures = (legacyCandidatures ?? []).map((item: any) => ({
                ...item,
                replacement_for_engagement_id: null,
              }))
            }
          } else {
            candidatures = candidaturesWithReplacement ?? null
          }

          if (candidatures && candidatures.length > 0) {
            const srvIds = [...new Set(candidatures.map((c: any) => c.serveur_id))]
            const { data: srvData } = await supabase
              .from('serveurs').select('id, prenom, nom').in('id', srvIds)

            if (srvData) {
              const srvMap: { [key: string]: string } = {}
              srvData.forEach((s: any) => { srvMap[s.id] = `${s.prenom} ${s.nom}` })
              const annonceMap: { [key: string]: any } = {}
              normalizedAnnonces.forEach((a: any) => { annonceMap[a.id] = a })

              const candidaturesOuvertes = candidatures.filter((c: any) => {
                const annonce = annonceMap[c.annonce_id]
                return isPendingMissionStatus(annonce?.statut) && !shouldHideMissionFromOpenLists(annonce?.statut, annonce?.date, annonce?.heure_debut, annonce?.heure_fin)
              })

              setCandidaturesRecues(candidaturesOuvertes.map((c: any) => ({
                annonce_id:  c.annonce_id,
                serveur_id:  c.serveur_id,
                replacement_for_engagement_id: c.replacement_for_engagement_id ?? null,
                serveur_nom: srvMap[c.serveur_id] ?? 'Inconnu',
                etablissement_nom: annonceMap[c.annonce_id]?.etablissement_id
                  ? etablissementNameMap[annonceMap[c.annonce_id].etablissement_id] ?? annonceMap[c.annonce_id]?.ville ?? patron?.nom_restaurant ?? 'Etablissement'
                  : patron?.nom_restaurant ?? annonceMap[c.annonce_id]?.ville ?? 'Etablissement',
                poste:       annonceMap[c.annonce_id]?.poste ?? 'Mission',
                ville:       annonceMap[c.annonce_id]?.ville ?? '',
                date:        annonceMap[c.annonce_id]?.date ?? '',
                heure_debut: annonceMap[c.annonce_id]?.heure_debut ?? '',
                heure_fin:   annonceMap[c.annonce_id]?.heure_fin ?? '',
              })))
            }
          } else {
            setCandidaturesRecues([])
          }
        } else {
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

  const annoncesOuvertes   = annonces.filter(a => isPendingMissionStatus(a.statut) && !shouldHideMissionFromOpenLists(a.statut, a.date, a.heure_debut, a.heure_fin))
  const annoncesAttribuees = annonces.filter(a => isAssignedMissionStatus(a.statut))
  const annoncesTerminees  = annonces.filter(a => isCompletedMissionStatus(a.statut))
  const nbTerminees       = annoncesTerminees.length
  const nbCandidatures    = candidaturesRecues.length

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
          <TouchableOpacity style={s.heroCta} onPress={() => router.push('/poster-annonce')} activeOpacity={0.88}>
            <Text style={s.heroCtaTxt}>Publier une mission</Text>
          </TouchableOpacity>
        </View>

        {/* STATS — 4 cartes */}
        <View style={s.statsGrid}>
          <TouchableOpacity
            style={[s.statCard, s.statCardThird, activeMissionFilter === 'ouverte' && s.statCardActive]}
            onPress={() => setActiveMissionFilter('ouverte')}
            activeOpacity={0.85}
          >
            <Text style={[s.statNum, { color: C.amber }]}>{annoncesOuvertes.length}</Text>
            <Text style={s.statLbl}>En attente</Text>
            <Text style={s.statSub}>sans personnel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.statCard, s.statCardThird, activeMissionFilter === 'terminee' && s.statCardActive]}
            onPress={() => setActiveMissionFilter('terminee')}
            activeOpacity={0.85}
          >
            <Text style={[s.statNum, { color: C.softDark }]}>{nbTerminees}</Text>
            <Text style={s.statLbl}>Terminees</Text>
            <Text style={s.statSub}>avec succes</Text>
          </TouchableOpacity>

          {/* CARTE CANDIDATURES */}
          <TouchableOpacity
            style={[s.statCard, s.statCardThird, nbCandidatures > 0 && s.statCardAlert]}
            onPress={() => setShowCandidatures(true)}
            activeOpacity={0.85}
          >
            <View style={s.statNumRow}>
              <Text style={[s.statNum, { color: nbCandidatures > 0 ? '#C56B3D' : C.muted }]}>
                {nbCandidatures}
              </Text>
            </View>
            <Text style={[s.statLbl, nbCandidatures > 0 && s.statLblAlert]}>
              {nbCandidatures === 0 ? 'Candidatures' : nbCandidatures === 1 ? '1 a traiter' : `${nbCandidatures} a traiter`}
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
                    {!annonce.note && annonce.serveur_id && (
                      <TouchableOpacity
                        style={s.evalAction}
                        onPress={() => router.push({ pathname: '/evaluer-serveur', params: { annonceId: annonce.id, serveurId: annonce.serveur_id, serveurNom: nomSrv || 'le prestataire' } })}
                        activeOpacity={0.85}
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

                  {isPendingMissionStatus(annonce.statut) && (
                    <View style={s.missionActionsRow}>
                      <TouchableOpacity
                        style={[s.primaryAction, s.primaryActionFlex]}
                        onPress={() => router.push({ pathname: '/serveurs-disponibles', params: { annonceId: annonce.id, ville: annonce.ville } })}
                        activeOpacity={0.88}
                      >
                        <Text style={s.primaryActionText}>Continuer la recherche</Text>
                        <Text style={s.primaryActionSubtext}>Proposez cette mission a d&apos;autres profils</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.softAction} onPress={() => annulerMission(annonce.id)} activeOpacity={0.88}>
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
                        <TouchableOpacity style={s.secondaryAction} onPress={() => terminerMission(annonce.id)} activeOpacity={0.88}>
                          <Text style={s.secondaryActionText}>Marquer comme terminee</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.softActionDanger} onPress={() => annulerMissionConfirmee(annonce.id)} activeOpacity={0.88}>
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
                <TouchableOpacity style={s.emptyCta} onPress={() => router.push('/poster-annonce')} activeOpacity={0.88}>
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
                  <TouchableOpacity style={[s.modalPrimaryBtn, ratingLoading && s.modalPrimaryBtnDisabled]} onPress={submitRating} disabled={ratingLoading} activeOpacity={0.88}>
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
              {nbCandidatures > 0 && (
                <View style={s.candModalBadge}>
                  <Text style={s.candModalBadgeTxt}>{nbCandidatures}</Text>
                </View>
              )}
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {candidaturesRecues.length === 0 ? (
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
                      activeOpacity={0.85}
                    >
                      <Text style={s.btnVoirProfilTxt}>Voir le profil</Text>
                    </TouchableOpacity>

                    <View style={s.actionsRow}>
                      <TouchableOpacity
                        style={[s.actionBtn, s.actionBtnTerra, { flex: 1 }]}
                        onPress={() => accepterCandidature(c.annonce_id, c.serveur_id, c.replacement_for_engagement_id)}
                        activeOpacity={0.85}
                      >
                        <Text style={s.actionBtnTxtWhite}>Selectionner</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.actionBtn, s.actionBtnRefus]}
                        onPress={() => { refuserCandidature(c.annonce_id, c.serveur_id) }}
                        activeOpacity={0.85}
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

  header:    { paddingTop: 56, paddingHorizontal: 24, paddingBottom: 22, alignItems: 'flex-start' },
  eyebrow:   { fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: C.muted, marginBottom: 6, fontWeight: '500' },
  nom:       { fontSize: 30, fontWeight: '700', color: C.title, letterSpacing: -0.4, lineHeight: 34 },
  headerVenue: { marginTop: 6, fontSize: 16, fontWeight: '700', color: C.terraDark },
  headerSub: { marginTop: 4, fontSize: 13, lineHeight: 19, color: C.soft, fontWeight: '500' },
  nomAccent: { color: C.terra },

  hero:         { marginHorizontal: 20, backgroundColor: C.card, borderRadius: 24, paddingHorizontal: 20, paddingVertical: 16, borderWidth: 1, borderColor: C.border, shadowColor: C.shadow, shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, elevation: 2 },
  heroTop:      { marginBottom: 10 },
  heroTitle:    { fontSize: 21, lineHeight: 26, fontWeight: '800', color: C.title, letterSpacing: -0.6 },
  heroSub:      { marginTop: 5, fontSize: 13, lineHeight: 19, color: C.soft, fontWeight: '500' },
  heroCta:      { backgroundColor: C.terra, borderRadius: 16, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.terraDark },
  heroCtaTxt:   { fontSize: 15, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.2 },

  statsGrid:       { flexDirection: 'row', flexWrap: 'wrap', margin: 20, marginBottom: 0, gap: 10 },
  statCardThird:   { width: '30.8%' },
  inProgressHintWrap: { marginHorizontal: 20, marginTop: 10, backgroundColor: C.cardWarm, borderWidth: 1, borderColor: C.borderSoft, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 },
  inProgressHintTxt:  { fontSize: 13, color: C.softDark, fontWeight: '600' },
  statCard:        { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 14, shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 1 }, shadowRadius: 4, elevation: 1 },
  statCardQuarter: { width: '47.5%' },
  statCardActive:  { borderColor: C.terra, backgroundColor: C.terraBg },
  statCardAlert:   { borderColor: '#E6A873', backgroundColor: '#FFF6ED' },
  statNumRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  statNum:         { fontSize: 34, fontWeight: '800', letterSpacing: -1, lineHeight: 36, marginBottom: 3 },
  statLbl:         { fontSize: 12, fontWeight: '600', color: C.text },
  statLblAlert:    { color: '#1A1715' },
  statSub:         { fontSize: 11, color: C.muted, marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.borderSoft },
  statSubAlert:    { color: '#8A7B70', borderTopColor: '#F0D7C1' },

  section:     { paddingHorizontal: 20, paddingTop: 32 },
  secRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  secTitle:    { fontSize: 22, fontWeight: '800', color: C.title, letterSpacing: -0.5 },
  secBadge:    { width: 24, height: 24, borderRadius: 12, backgroundColor: C.terra, alignItems: 'center', justifyContent: 'center' },
  secBadgeTxt: { fontSize: 11, fontWeight: '800', color: '#fff' },

  cardMb: { marginBottom: 12 },

  missionCard:       { backgroundColor: C.card, borderRadius: 24, padding: 20, borderWidth: 1, borderColor: C.border, shadowColor: C.shadow, shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  missionTop:        { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 },
  missionTitleWrap:  { flex: 1, paddingRight: 12 },
  missionTitle:      { fontSize: 20, fontWeight: '800', color: C.title, marginBottom: 5, letterSpacing: -0.4 },
  missionEtablissement: { fontSize: 12, color: C.softDark, fontWeight: '700', marginBottom: 4 },
  missionSubtitle:   { fontSize: 13, color: C.soft, lineHeight: 18 },
  missionInfoRow:    { flexDirection: 'row', gap: 10, marginBottom: 14 },
  missionInfoCard:   { flex: 1, backgroundColor: C.cardWarm, borderRadius: 16, borderWidth: 1, borderColor: C.borderSoft, paddingHorizontal: 14, paddingVertical: 12 },
  missionInfoLabel:  { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, color: C.muted, marginBottom: 6 },
  missionInfoValue:  { fontSize: 14, fontWeight: '700', color: C.text },
  missionFooter:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2, marginBottom: 16 },
  missionCity:       { fontSize: 14, color: C.softDark, fontWeight: '600' },
  missionPrice:      { fontSize: 15, color: C.terraDark, fontWeight: '800', letterSpacing: -0.2 },
  missionActionsRow: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },

  statusBadge:     { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, marginLeft: 10 },
  statusBadgeText: { fontSize: 12, fontWeight: '700' },

  primaryAction:        { backgroundColor: C.terra, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.terraDark },
  primaryActionText:    { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  primaryActionSubtext: { marginTop: 4, color: 'rgba(255,255,255,0.78)', fontSize: 11, lineHeight: 15, fontWeight: '600', textAlign: 'center' },
  primaryActionFlex:    { flex: 1 },
  secondaryAction:      { backgroundColor: '#F6F1E8', borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
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

  badge:    { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeTxt: { fontSize: 11, fontWeight: '700' },

  emptyCard:   { backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.border, padding: 26, alignItems: 'center' },
  emptyTitle:  { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 8 },
  emptySub:    { fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  emptyCta:    { backgroundColor: C.terra, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12 },
  emptyCtaTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },

  histoCard:      { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 18 },
  acHeader:       { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  histoPoste:     { fontSize: 16, fontWeight: '700', color: C.softDark, marginBottom: 3 },
  histoMeta:      { fontSize: 12, color: C.muted },
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
  candCard:          { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 16 },
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
  actionBtnTerra:    { backgroundColor: C.terra, borderColor: C.terra },
  actionBtnRefus:    { backgroundColor: C.redBg, borderColor: C.redBd, paddingHorizontal: 16 },
  actionBtnTxt:      { fontSize: 13, fontWeight: '700' },
  actionBtnTxtWhite: { fontSize: 13, fontWeight: '700', color: '#fff' },
})
