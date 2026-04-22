import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { selectServeurForMission } from '../lib/annonces'
import { fetchRecentEvaluations, type EvaluationRecente } from '../lib/evaluations'
import {
  CANONICAL_WEEKLY_AVAILABILITY_SLOTS,
  WEEKLY_AVAILABILITY_DAYS,
  type AvailabilityDayKey,
  type CanonicalAvailabilitySlotKey,
  type ServeurDisponibiliteHebdo,
} from '../lib/serveur-disponibilites'
import { fetchServeurDisponibilitesHebdo } from '../lib/serveur-disponibilites-api'
import {
  formatServeurExperience,
  getPrimaryServeurExperienceLabel,
  getServeurExperiencesBio,
  type ServeurExperience,
} from '../lib/serveur-experiences'
import { fetchServeurExperiences } from '../lib/serveur-experiences-api'
import { getPresenceBadge, getPresenceRate } from '../lib/serveur-presence'
import { computeServeurMissionStatsFromAnnonces } from '../lib/serveur-stats'
import { getServerBusySlotMessage } from '../lib/server-availability'
import { supabase } from '../lib/supabase'

interface Serveur {
  id: string
  prenom: string
  nom: string
  ville: string
  disponible: boolean
  score: number | null
  missions_realisees: number | null
  missions_acceptees: number | null
  missions_annulees: number | null
  rayon: number
  badge: string | null
  photo_url?: string | null
  description?: string | null
  lat: number | null
  lng: number | null
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function toSafeNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function initialesAvatar(prenom: string, nom: string): string {
  return `${prenom?.[0] ?? ''}${nom?.[0] ?? ''}`.toUpperCase()
}

function niveauLabel(missions: number): string {
  const s = toSafeNumber(missions)
  if (s >= 50) return 'Expert'
  if (s >= 10) return 'Confirmé'
  if (s >= 5) return 'Habitué'
  return 'Nouveau'
}
function formatMissionCount(count: number): string {
  return `${count} mission${count > 1 ? 's' : ''}`
}
function formatPresenceSummary(missions: number, absences: number): string {
  if (missions <= 0) return 'Nouveau'
  if (absences <= 0) return '100% présent'
  if (absences === 1) return '1 absence'
  return `${absences} absences`
}

function descriptionCourte(serveur: Serveur): string {
  if (serveur.description?.trim()) return serveur.description.trim()

  const missions = toSafeNumber(serveur.missions_realisees)
  const annulees = toSafeNumber(serveur.missions_annulees)
  const taux = getPresenceRate(missions, annulees)

  const base =
    missions < 5
      ? 'Profil débutant motivé. Sérieux et volontaire, disponible pour des missions courtes et souhaite progresser rapidement.'
      : missions < 10
        ? "Serveur habitué aux missions, fiable et appliqué. S'adapte rapidement aux environnements de travail."
        : missions < 50
          ? 'Serveur confirmé, autonome et efficace. Bonne gestion du service et des clients.'
          : 'Serveur expérimenté, très fiable et rapide. Habitué aux services exigeants et forte affluence.'

  return (taux ?? 0) >= 95 ? `${base} Très fiable, présence régulière.` : base
}

function bioLongue(serveur: Serveur, experiences: ServeurExperience[]): string {
  const missions = toSafeNumber(serveur.missions_realisees)
  const annulees = toSafeNumber(serveur.missions_annulees)
  const experiencesBio = getServeurExperiencesBio(experiences)

  return [
    `Expériences : ${experiencesBio}`,
    `Missions réalisées : ${missions}`,
    `Présence : ${formatPresenceSummary(missions, annulees)}`,
    `Rayon de déplacement : ${serveur.rayon} km autour de ${serveur.ville}`,
    `Absences : ${annulees}`,
    '',
    descriptionCourte(serveur),
  ].join('\n')
}

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
  greenDark: '#1F6A42',
  greenBg: '#F0F8F3',
  greenBd: '#C0DEC8',
  olive: '#6A7452',
  oliveBg: '#F3F2E9',
  oliveBd: '#DFD8BF',
  amber: '#B8893C',
  amberBg: '#FBF5E8',
  amberBd: '#E8D4A0',
  blue: '#4B55C8',
  blueBg: '#EEF0FE',
  blueBd: '#C7CCF8',
  shadow: '#2B2118',
}

const SAFE_WEEKLY_DAYS: { key: AvailabilityDayKey; label: string }[] =
  (WEEKLY_AVAILABILITY_DAYS ?? []) as { key: AvailabilityDayKey; label: string }[]

const SLOTS_VISIBLES: { key: CanonicalAvailabilitySlotKey; label: string }[] =
  CANONICAL_WEEKLY_AVAILABILITY_SLOTS

const SLOT_LABELS: Record<CanonicalAvailabilitySlotKey, string> = {
  midday: 'Midi',
  evening: 'Soir',
}

function DispoGrid({ availabilities }: { availabilities: ServeurDisponibiliteHebdo[] }) {
  const safeAvailabilities: ServeurDisponibiliteHebdo[] = availabilities ?? []
  const safeDays: { key: AvailabilityDayKey; label: string }[] = SAFE_WEEKLY_DAYS

  const hasAny = safeAvailabilities.length > 0

  if (!hasAny) {
    return (
      <View style={dg.empty}>
        <Text style={dg.emptyTxt}>Aucune disponibilité renseignée</Text>
      </View>
    )
  }

  return (
    <>
      <View style={dg.legend}>
        {SLOTS_VISIBLES.map((slot: { key: CanonicalAvailabilitySlotKey; label: string }) => (
          <View key={slot.key} style={dg.legendItem}>
            <View style={dg.legendDot}>
              <Text style={dg.legendInitiale}>{SLOT_LABELS[slot.key]}</Text>
            </View>
            <Text style={dg.legendTxt}>{slot.label}</Text>
          </View>
        ))}
        <View style={dg.legendItem}>
          <View style={[dg.legendDot, dg.legendDotJournee]}>
            <Text style={[dg.legendInitiale, dg.legendInitialeJournee]}>Journée</Text>
          </View>
          <Text style={dg.legendTxt}>Midi + Soir</Text>
        </View>
      </View>

      <View style={dg.grid}>
        {safeDays.map((day: { key: AvailabilityDayKey; label: string }) => {
          const hasMidday = safeAvailabilities.some(
            (item: ServeurDisponibiliteHebdo) => item.jour === day.key && item.creneau === 'midday'
          )
          const hasEvening = safeAvailabilities.some(
            (item: ServeurDisponibiliteHebdo) => item.jour === day.key && item.creneau === 'evening'
          )
          const isFullDay = hasMidday && hasEvening
          const isDayActive = isFullDay || SLOTS_VISIBLES.some((slot: { key: CanonicalAvailabilitySlotKey; label: string }) =>
            safeAvailabilities.some((item: ServeurDisponibiliteHebdo) =>
              item.jour === day.key && item.creneau === slot.key
            )
          )

          return (
            <View key={day.key} style={[dg.dayCard, isDayActive && dg.dayCardActive]}>
              <View style={dg.dayLabelWrap}>
                <Text style={[dg.dayLabel, isDayActive && dg.dayLabelActive]}>
                  {day.label}
                </Text>
              </View>

              <View style={dg.daySlots}>
                {isFullDay ? (
                  <View style={[dg.slotDot, dg.slotDotJournee]}>
                    <Text style={[dg.slotTxt, dg.slotTxtActive]}>Journée</Text>
                  </View>
                ) : (
                  SLOTS_VISIBLES.map((slot: { key: CanonicalAvailabilitySlotKey; label: string }) => {
                    const selected = safeAvailabilities.some((item: ServeurDisponibiliteHebdo) =>
                      item.jour === day.key && item.creneau === slot.key
                    )

                    return (
                      <View
                        key={`${day.key}-${slot.key}`}
                        style={[dg.slotDot, selected && dg.slotDotActive]}
                      >
                        <Text style={[dg.slotTxt, selected && dg.slotTxtActive]}>
                          {SLOT_LABELS[slot.key]}
                        </Text>
                      </View>
                    )
                  })
                )}
              </View>
            </View>
          )
        })}
      </View>
    </>
  )
}

export default function ProfilServeurPublic() {
  const router = useRouter()
  const { serveurId, annonceId, replaceEngagementId } = useLocalSearchParams()
  const serveurIdParam = Array.isArray(serveurId) ? serveurId[0] : serveurId
  const annonceIdParam = Array.isArray(annonceId) ? annonceId[0] : annonceId
  const replaceEngagementIdParam = Array.isArray(replaceEngagementId) ? replaceEngagementId[0] : replaceEngagementId

  const [serveur, setServeur] = useState<Serveur | null>(null)
  const [avisRecents, setAvisRecents] = useState<EvaluationRecente[]>([])
  const [loading, setLoading] = useState(true)
  const [showDetail, setShowDetail] = useState(false)
  const [hasPendingCandidature, setHasPendingCandidature] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [distanceKm, setDistanceKm] = useState<number | null>(null)
  const [experiences, setExperiences] = useState<ServeurExperience[]>([])
  const [availabilities, setAvailabilities] = useState<ServeurDisponibiliteHebdo[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    const load = async () => {
      console.info('profil-serveur-public: chargement', {
        serveurId: serveurIdParam ?? null,
        annonceId: annonceIdParam ?? null,
      })

      if (!serveurIdParam || typeof serveurIdParam !== 'string') {
        if (mounted) setLoadError('Identifiant serveur manquant.')
        if (mounted) setLoading(false)
        return
      }

      try {
        const { data, error } = await supabase
          .from('serveurs')
          .select('*')
          .eq('id', serveurIdParam)
          .single()

        console.info('profil-serveur-public: resultat requete serveur', {
          requestedId: serveurIdParam,
          found: Boolean(data),
          returnedId: data?.id ?? null,
          error: error?.message ?? null,
        })

        if (!error && data && mounted) {
          const stats = await computeServeurMissionStatsFromAnnonces(serveurIdParam)
          setServeur({
            ...(data as Serveur),
            missions_realisees: stats.completedMissions,
            missions_annulees: stats.noShowMissions,
          })
          setLoadError(null)
        } else if (mounted) {
          setLoadError(error?.message ?? 'Serveur introuvable.')
        }

        const nextExperiences = await fetchServeurExperiences(serveurIdParam)
        if (mounted) setExperiences(nextExperiences ?? [])

        const nextAvailabilities = await fetchServeurDisponibilitesHebdo(serveurIdParam)
        if (mounted) setAvailabilities(nextAvailabilities ?? [])

        const evaluations = await fetchRecentEvaluations(serveurIdParam)
        if (mounted) setAvisRecents(evaluations ?? [])

        if (annonceIdParam && typeof annonceIdParam === 'string') {
          const { data: annonceData } = await supabase
            .from('annonces')
            .select('lat, lng')
            .eq('id', annonceIdParam)
            .maybeSingle()

          if (
            data?.lat != null &&
            data?.lng != null &&
            annonceData?.lat != null &&
            annonceData?.lng != null &&
            mounted
          ) {
            setDistanceKm(
              Math.round(haversineKm(data.lat, data.lng, annonceData.lat, annonceData.lng))
            )
          }

          const { data: candidatureData, error: candidatureError } = await supabase
            .from('demandes')
            .select('id')
            .eq('annonce_id', annonceIdParam)
            .eq('serveur_id', serveurIdParam)
            .eq('initiateur', 'serveur')
            .eq('statut', 'en_attente')
            .maybeSingle()

          if (!candidatureError && mounted) {
            setHasPendingCandidature(Boolean(candidatureData))
          }
        } else if (mounted) {
          setHasPendingCandidature(false)
          setDistanceKm(null)
        }
      } catch (e) {
        console.error('profil serveur public load error:', e)
        if (mounted) setLoadError('Impossible de charger ce profil.')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()

    return () => {
      mounted = false
    }
  }, [annonceIdParam, serveurIdParam])

  if (loading) {
    return (
      <View style={s.loadWrap}>
        <ActivityIndicator size="large" color={C.terra} />
      </View>
    )
  }

  if (!serveur) {
    return (
      <View style={s.loadWrap}>
        <Text style={s.errorTxt}>{loadError ?? 'Profil introuvable'}</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.backLink}>← Retour</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const initials = initialesAvatar(serveur.prenom, serveur.nom)
  const missions = toSafeNumber(serveur.missions_realisees)
  const noShowCount = toSafeNumber(serveur.missions_annulees)
  const niveau = niveauLabel(missions)
  const primaryExperienceLabel = getPrimaryServeurExperienceLabel(experiences)
  const description = descriptionCourte(serveur)
  const bioFull = bioLongue(serveur, experiences)
  const noteAff = serveur.score != null ? serveur.score.toFixed(1) : null
  const distanceLabel = distanceKm != null ? `${distanceKm} km` : `${serveur.rayon} km`
  const distanceMetricLabel = distanceKm != null ? 'Distance' : 'Rayon'
  const presenceBadge = getPresenceBadge(serveur.missions_realisees, serveur.missions_annulees)
  const presenceSummary = formatPresenceSummary(missions, noShowCount)
  const presenceRateValue = missions > 0 ? `${getPresenceRate(missions, noShowCount)}%` : 'Nouveau'
  const experienceValue = formatMissionCount(missions)
  const noteValue = noteAff ?? 'Pas encore noté'

  const presenceBadgeStyle = (() => {
    switch (presenceBadge.tone) {
      case 'very_reliable':
        return { bg: C.greenBg, bd: C.greenBd, txt: C.greenDark }
      case 'reliable':
        return { bg: C.oliveBg, bd: C.oliveBd, txt: C.olive }
      case 'fair':
        return { bg: C.terraBg, bd: C.terraBd, txt: C.terraDark }
      case 'uncertain':
        return { bg: C.cardSoft, bd: C.borderSoft, txt: C.textSoft }
      case 'new':
      default:
        return { bg: C.amberBg, bd: C.amberBd, txt: C.amber }
    }
  })()

  const badges = [
    missions <= 0 ? { lbl: 'Nouveau', bg: C.amberBg, bd: C.amberBd, txt: C.amber } : null,
    { lbl: presenceSummary, bg: presenceBadgeStyle.bg, bd: presenceBadgeStyle.bd, txt: presenceBadgeStyle.txt },
    serveur.disponible ? { lbl: 'Disponible', bg: C.blueBg, bd: C.blueBd, txt: C.blue } : null,
  ].filter(Boolean) as { lbl: string; bg: string; bd: string; txt: string }[]

  const quickStats = [
    { lbl: 'Présence', val: presenceRateValue },
    { lbl: 'Expérience', val: experienceValue },
    { lbl: 'Absences', val: `${noShowCount}` },
    { lbl: distanceMetricLabel, val: distanceLabel },
    { lbl: 'Note', val: noteValue },
  ]

  const handleAcceptCandidature = async () => {
    if (!annonceIdParam || typeof annonceIdParam !== 'string') {
      Alert.alert('Erreur', 'Annonce introuvable')
      return
    }

    setAccepting(true)

    try {
      const result = await selectServeurForMission(annonceIdParam, serveur.id, {
        replacedEngagementId:
          typeof replaceEngagementIdParam === 'string' && replaceEngagementIdParam.trim()
            ? replaceEngagementIdParam
            : null,
      })

      if (!result.ok) {
        Alert.alert(
          'Information',
          result.reason === 'already_assigned'
            ? 'Cette mission est déjà pourvue.'
            : result.reason === 'worker_unavailable'
              ? getServerBusySlotMessage(null, 'profile')
            : 'Impossible de sélectionner ce profil.'
        )
        return
      }

      setHasPendingCandidature(false)

      Alert.alert('Succès', 'Le profil a bien été sélectionné pour cette mission.', [
        { text: 'OK', onPress: () => router.replace('/dashboard_patron') },
      ])
    } catch {
      Alert.alert('Erreur', 'Impossible de sélectionner ce profil.')
    } finally {
      setAccepting(false)
    }
  }

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Text style={s.backTxt}>← Retour</Text>
        </TouchableOpacity>

        <View style={s.headerCard}>
          <View style={s.headerLeft}>
            <Text style={s.headerNom}>{serveur.prenom} {serveur.nom}</Text>
            <Text style={s.headerSous}>
              {niveau} - {missions} mission{missions > 1 ? 's' : ''} réalisée{missions > 1 ? 's' : ''}
            </Text>
            <View style={s.chipsRow}>
              <View style={s.chip}>
                <Text style={s.chipTxt}>{serveur.ville}</Text>
              </View>
              <View style={s.chip}>
                <Text style={s.chipTxt}>{primaryExperienceLabel}</Text>
              </View>
            </View>
          </View>

          <View style={s.headerRight}>
            {serveur.photo_url ? (
              <View style={s.avatarImageWrap}>
                <Image source={{ uri: serveur.photo_url }} style={s.avatarImage} />
                <View style={[s.avatarDot, !serveur.disponible && s.avatarDotOff]} />
              </View>
            ) : (
              <View style={s.avatar}>
                <Text style={s.avatarTxt}>{initials}</Text>
                <View style={[s.avatarDot, !serveur.disponible && s.avatarDotOff]} />
              </View>
            )}
            {noteAff && (
              <View style={s.noteBadge}>
                <Text style={s.noteBadgeTxt}>Note {noteAff}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={s.sectionCard}>
          <Text style={s.sectionTitle}>Description</Text>
          <Text style={s.descText}>{description}</Text>
        </View>

        <View style={s.sectionCard}>
          <Text style={s.sectionTitle}>Expériences</Text>
          {experiences.length > 0 ? (
            <View style={s.experiencesList}>
              {experiences.map((item, index) => (
                <View key={`exp-${index}-${item.poste}`} style={s.experienceCard}>
                  <Text style={s.experienceTitle}>{item.poste}</Text>
                  <Text style={s.experienceMeta}>{item.description}</Text>
                  <Text style={s.experienceDuration}>{item.duree}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={s.experienceFallbackCard}>
              <Text style={s.experienceFallbackText}>
                Aucune expérience structurée renseignée pour le moment.
              </Text>
            </View>
          )}
        </View>

        <View style={s.sectionCard}>
          <Text style={s.sectionTitle}>Disponibilités habituelles</Text>
          <DispoGrid availabilities={availabilities ?? []} />
        </View>

        <View style={s.sectionCard}>
          <Text style={s.sectionTitle}>Repères rapides</Text>

          <View style={s.metricsGrid}>
            {quickStats.map((item, index) => (
              <View key={`${item.lbl}-${index}`} style={s.metricCard}>
                <Text style={s.metricLabel}>{item.lbl}</Text>
                <Text style={s.metricValue}>{item.val}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.sectionCard}>
          <View style={s.avisHeader}>
            <Text style={s.sectionTitle}>Avis récents</Text>
            {noteAff && (
              <View style={s.avisNoteBadge}>
                <Text style={s.avisNoteVal}>{noteAff}</Text>
                <Text style={s.avisNoteStar}>Note</Text>
              </View>
            )}
          </View>

          {avisRecents.length === 0 ? (
            <View style={s.avisEmptyWrap}>
              <Text style={s.avisEmpty}>Aucun avis pour le moment</Text>
            </View>
          ) : (
            <View style={s.avisList}>
              {avisRecents.slice(0, 5).map((avis, index) => (
                <View
                  key={`avis-${avis.id}-${index}`}
                  style={[s.avisCard, index < avisRecents.length - 1 && s.avisCardMb]}
                >
                  <View style={s.avisCardTop}>
                    <View style={s.avisStarsRow}>
                      {[1, 2, 3, 4, 5].map((n: number) => (
                        <View
                          key={`star-${avis.id}-${index}-${n}`}
                          style={[s.avisStar, { backgroundColor: avis.note >= n ? C.amber : '#D7CFC3' }]}
                        />
                      ))}
                    </View>
                    <Text style={s.avisMeta}>
                      {avis.mission_poste ?? 'Mission'}
                      {avis.mission_date ? ` - ${avis.mission_date}` : ''}
                    </Text>
                  </View>
                  <Text style={s.avisComment}>{avis.commentaire}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <TouchableOpacity style={s.secondaryCta} onPress={() => setShowDetail(true)} activeOpacity={0.85}>
          <Text style={s.secondaryCtaTxt}>Voir les stats complètes</Text>
        </TouchableOpacity>

        {hasPendingCandidature && (
          <TouchableOpacity
            style={[s.primaryCta, accepting && { opacity: 0.7 }]}
            onPress={handleAcceptCandidature}
            activeOpacity={0.85}
            disabled={accepting}
          >
            <Text style={s.primaryCtaTxt}>
              {accepting ? 'Sélection en cours...' : 'Sélectionner pour cette mission'}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal visible={showDetail} transparent animationType="slide" onRequestClose={() => setShowDetail(false)}>
        <View style={s.modalOverlay}>
          <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setShowDetail(false)} />
          <View style={s.modalSheet}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.modalHandle} />

              <View style={s.modalHeader}>
                <View style={s.modalAvatar}>
                  <Text style={s.modalAvatarTxt}>{initials}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.modalNom}>{serveur.prenom} {serveur.nom}</Text>
                  <Text style={s.modalSous}>{primaryExperienceLabel} - {serveur.ville}</Text>
                </View>
              </View>

              <View style={s.modalBadgesRow}>
                {badges.map((b, index) => (
                  <View key={`${b.lbl}-${index}`} style={[s.badge, { backgroundColor: b.bg, borderColor: b.bd }]}>
                    <Text style={[s.badgeTxt, { color: b.txt }]}>{b.lbl}</Text>
                  </View>
                ))}
              </View>

              <Text style={s.modalSecTitle}>Statistiques</Text>

              <View style={s.modalStatsGrid}>
                {quickStats.map((item, index) => (
                  <View key={`${item.lbl}-${index}`} style={s.modalStatCard}>
                    <Text style={s.modalStatLbl}>{item.lbl}</Text>
                    <Text style={s.modalStatVal}>{item.val}</Text>
                  </View>
                ))}
              </View>

              <Text style={s.modalSecTitle}>Profil complet</Text>

              <View style={s.modalBioCard}>
                <Text style={s.modalBioTxt}>{bioFull}</Text>
              </View>

              {experiences.length > 0 && (
                <>
                  <Text style={s.modalSecTitle}>Expériences</Text>
                  <View style={s.modalExperiencesList}>
                    {experiences.map((item, index) => (
                      <View key={`modal-exp-${index}-${item.poste}`} style={s.modalExperienceCard}>
                        <Text style={s.modalExperienceText}>{formatServeurExperience(item)}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}

              <Text style={s.modalSecTitle}>Disponibilités habituelles</Text>

              <View style={{ marginBottom: 16 }}>
                <DispoGrid availabilities={availabilities ?? []} />
              </View>

              <View style={[s.dispoCard, serveur.disponible ? s.dispoCardOn : s.dispoCardOff]}>
                <View style={[s.dispoDot, serveur.disponible ? s.dispoDotOn : s.dispoDotOff]} />
                <Text style={[s.dispoTxt, serveur.disponible ? s.dispoTxtOn : s.dispoTxtOff]}>
                  {serveur.disponible ? 'Disponible actuellement' : 'Indisponible actuellement'}
                </Text>
              </View>

              <TouchableOpacity style={s.modalCloseBtn} onPress={() => setShowDetail(false)} activeOpacity={0.85}>
                <Text style={s.modalCloseBtnTxt}>Fermer</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const dg = StyleSheet.create({
  empty: { paddingVertical: 10, alignItems: 'center' },
  emptyTxt: { fontSize: 13, color: '#9A9388', fontStyle: 'italic' },
  legend: { flexDirection: 'row', gap: 14, marginBottom: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: {
    minWidth: 28,
    height: 20,
    borderRadius: 6,
    backgroundColor: '#F1EBE3',
    borderWidth: 1,
    borderColor: '#E0D5CB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendInitiale: { fontSize: 9, fontWeight: '800', color: '#9A8880' },
  legendDotJournee: {
    paddingHorizontal: 6,
    backgroundColor: '#F1EBE3',
    borderColor: '#E0D5CB',
  },
  legendInitialeJournee: { color: '#5E544C' },
  legendTxt: { fontSize: 12, color: '#8A7B70', fontWeight: '500' },
  grid: { gap: 8 },
  dayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FCF8F2',
    borderWidth: 1,
    borderColor: '#E8DED1',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
  },
  dayCardActive: { backgroundColor: '#FFF6ED', borderColor: '#F0C7A8' },
  dayLabelWrap: {
    width: 92,
    justifyContent: 'center',
  },
  dayLabel: { fontSize: 12, fontWeight: '800', color: '#9A8880', letterSpacing: 0.2 },
  dayLabelActive: { color: '#C46A3C' },
  daySlots: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'flex-end',
    gap: 6,
  },
  slotDot: {
    minWidth: 32,
    height: 20,
    borderRadius: 6,
    backgroundColor: '#F1EBE3',
    borderWidth: 1,
    borderColor: '#E0D5CB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotDotActive: { backgroundColor: '#C46A3C', borderColor: '#C46A3C' },
  slotDotJournee: {
    minWidth: 58,
    paddingHorizontal: 8,
    backgroundColor: '#F1EBE3',
    borderColor: '#E0D5CB',
  },
  slotTxt: { fontSize: 8, fontWeight: '700', color: '#5E544C' },
  slotTxtActive: { color: '#FFFFFF' },
})

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  loadWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },
  errorTxt: { fontSize: 16, color: C.textMuted, marginBottom: 12 },
  backLink: { fontSize: 14, color: C.terra, fontWeight: '700' },
  backBtn: { paddingTop: 56, marginBottom: 20, alignSelf: 'flex-start' },
  backTxt: { fontSize: 15, color: C.terra, fontWeight: '700' },

  headerCard: {
    backgroundColor: C.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    shadowColor: C.shadow,
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 3,
  },
  headerLeft: { flex: 1, paddingRight: 14 },
  headerNom: { fontSize: 24, fontWeight: '800', color: C.title, letterSpacing: -0.5, marginBottom: 4 },
  headerSous: { fontSize: 13, color: C.textMuted, marginBottom: 12, fontWeight: '500' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: C.cardSoft,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipTxt: { fontSize: 12, color: C.textSoft, fontWeight: '600' },
  headerRight: { alignItems: 'center', gap: 8 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.terraBg,
    borderWidth: 2,
    borderColor: C.terraBd,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  avatarImageWrap: {
    width: 64,
    height: 64,
    position: 'relative',
  },
  avatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: C.terraBd,
    backgroundColor: C.terraBg,
  },
  avatarTxt: { fontSize: 22, fontWeight: '800', color: C.terra },
  avatarDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: C.green,
    borderWidth: 2,
    borderColor: C.card,
  },
  avatarDotOff: { backgroundColor: C.textMuted },
  noteBadge: {
    backgroundColor: C.amberBg,
    borderWidth: 1,
    borderColor: C.amberBd,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  noteBadgeTxt: { fontSize: 11, fontWeight: '700', color: C.amber },

  sectionCard: {
    backgroundColor: C.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
    marginBottom: 14,
    shadowColor: C.shadow,
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 2,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: C.title, letterSpacing: -0.3, marginBottom: 12 },
  descText: { fontSize: 15, lineHeight: 23, color: C.textSoft },

  experiencesList: { gap: 10 },
  experienceCard: {
    backgroundColor: C.cardSoft,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 18,
    padding: 14,
  },
  experienceTitle: { fontSize: 15, fontWeight: '800', color: C.title, marginBottom: 4 },
  experienceMeta: { fontSize: 13, color: C.textSoft, fontWeight: '600', marginBottom: 6 },
  experienceDuration: { fontSize: 12, color: C.terra, fontWeight: '700' },
  experienceFallbackCard: {
    backgroundColor: C.cardSoft,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 16,
    padding: 14,
  },
  experienceFallbackText: { fontSize: 14, lineHeight: 21, color: C.textSoft },

  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  badge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1 },
  badgeTxt: { fontSize: 12, fontWeight: '700' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: {
    width: '48%',
    backgroundColor: C.cardSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderSoft,
    minHeight: 92,
    paddingHorizontal: 14,
    paddingVertical: 14,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  metricValue: { fontSize: 24, fontWeight: '800', color: C.title, letterSpacing: -0.6, lineHeight: 28 },
  metricLabel: { fontSize: 11, color: C.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },

  avisHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  avisNoteBadge: {
    backgroundColor: C.amberBg,
    borderWidth: 1,
    borderColor: C.amberBd,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  avisNoteVal: { fontSize: 20, fontWeight: '800', color: C.amber, letterSpacing: -0.5 },
  avisNoteStar: { fontSize: 10, color: C.amber, fontWeight: '600', marginTop: 1 },
  avisList: { gap: 10 },
  avisCard: {
    backgroundColor: C.cardSoft,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 18,
    padding: 14,
  },
  avisCardMb: { marginBottom: 0 },
  avisCardTop: { marginBottom: 8 },
  avisStarsRow: { flexDirection: 'row', gap: 4, marginBottom: 6 },
  avisStar: { width: 12, height: 12, borderRadius: 6 },
  avisMeta: { fontSize: 12, color: C.textMuted, fontWeight: '600' },
  avisComment: { fontSize: 14, lineHeight: 21, color: C.textSoft },
  avisEmptyWrap: { paddingVertical: 12, alignItems: 'center' },
  avisEmpty: { fontSize: 13, color: C.textMuted, textAlign: 'center', fontStyle: 'italic' },

  secondaryCta: {
    backgroundColor: C.card,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 10,
  },
  secondaryCtaTxt: { fontSize: 14, fontWeight: '700', color: C.textSoft },
  primaryCta: {
    backgroundColor: C.terra,
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.terraDark,
    shadowColor: C.terra,
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 5,
    marginBottom: 16,
  },
  primaryCtaTxt: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,22,20,0.4)' },
  modalBackdrop: { flex: 1 },
  modalSheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 40,
    maxHeight: '88%',
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: C.border,
    marginBottom: 20,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  modalAvatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: C.terraBg,
    borderWidth: 1,
    borderColor: C.terraBd,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalAvatarTxt: { fontSize: 18, fontWeight: '800', color: C.terra },
  modalNom: { fontSize: 18, fontWeight: '800', color: C.title, letterSpacing: -0.3 },
  modalSous: { fontSize: 13, color: C.textMuted, marginTop: 2 },
  modalBadgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  modalSecTitle: { fontSize: 15, fontWeight: '800', color: C.title, marginBottom: 12, letterSpacing: -0.2 },
  modalStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  modalStatCard: {
    width: '48%',
    backgroundColor: C.cardSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderSoft,
    minHeight: 92,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  modalStatVal: { fontSize: 22, fontWeight: '800', color: C.title, letterSpacing: -0.5, lineHeight: 26 },
  modalStatLbl: { fontSize: 11, color: C.textMuted, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  modalBioCard: {
    backgroundColor: C.cardSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderSoft,
    padding: 16,
    marginBottom: 16,
  },
  modalBioTxt: { fontSize: 14, lineHeight: 21, color: C.textSoft },
  modalExperiencesList: { gap: 10, marginBottom: 16 },
  modalExperienceCard: {
    backgroundColor: C.cardSoft,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 14,
    padding: 14,
  },
  modalExperienceText: { fontSize: 14, lineHeight: 20, color: C.textSoft, fontWeight: '600' },
  dispoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
    gap: 8,
  },
  dispoCardOn: { backgroundColor: C.greenBg, borderColor: C.greenBd },
  dispoCardOff: { backgroundColor: C.cardSoft, borderColor: C.border },
  dispoDot: { width: 8, height: 8, borderRadius: 4 },
  dispoDotOn: { backgroundColor: C.green },
  dispoDotOff: { backgroundColor: C.textMuted },
  dispoTxt: { fontSize: 14, fontWeight: '600' },
  dispoTxtOn: { color: C.green },
  dispoTxtOff: { color: C.textMuted },
  modalCloseBtn: {
    backgroundColor: C.cardSoft,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalCloseBtnTxt: { fontSize: 15, fontWeight: '700', color: C.textSoft },
})
