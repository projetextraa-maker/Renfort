import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Alert, Image, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import {
  getProfilePhotoErrorMessage,
  pickProfilePhoto,
  removeProfilePhoto,
  saveProfilePhotoUrl,
  uploadProfilePhoto,
} from '../../lib/profile-photo'
import { formatServeurExperience, type ServeurExperience } from '../../lib/serveur-experiences'
import { fetchServeurExperiences } from '../../lib/serveur-experiences-api'
import { computeServeurMissionStatsFromAnnonces, getServeurExperienceBadgeLabel } from '../../lib/serveur-stats'
import { supabase } from '../../lib/supabase'

const C = {
  bg: '#F6F1E8',
  card: '#FFFCF8',
  cardSoft: '#F8F2E8',
  border: '#E8DED0',
  borderSoft: '#EFE7DB',
  title: '#1A1612',
  textSoft: '#6A6157',
  textMuted: '#9C9287',
  accent: '#1F6B45',
  terra: '#C46A3C',
  amber: '#B8893C',
  red: '#C84B4B',
}

export default function ProfilServeurScreen() {
  const router = useRouter()
  const [serveur, setServeur] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [experiences, setExperiences] = useState<ServeurExperience[]>([])
  const [photoLoading, setPhotoLoading] = useState(false)
  const [showAllExperiences, setShowAllExperiences] = useState(false)

  const chargerProfil = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase.from('serveurs').select('*').eq('id', user.id).single()
    if (!error && data) {
      const stats = await computeServeurMissionStatsFromAnnonces(data.id)
      setServeur({
        ...data,
        missions_realisees: stats.completedMissions,
        missions_annulees: stats.noShowMissions,
      })
      const nextExp = await fetchServeurExperiences(data.id)
      setExperiences(nextExp)
    }

    setLoading(false)
  }

  useFocusEffect(
    useCallback(() => {
      chargerProfil()
    }, [])
  )

  const handleDeconnexion = async () => {
    Alert.alert('Se deconnecter', 'Voulez-vous vous deconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Se deconnecter',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut()
          router.replace('/')
        },
      },
    ])
  }

  const rafraichirServeurPhoto = (photoUrl: string | null) => {
    setServeur((current: any) => (current ? { ...current, photo_url: photoUrl } : current))
  }

  const handlePhotoSelection = async (source: 'camera' | 'library') => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user || !serveur) return

    try {
      setPhotoLoading(true)
      const photo = await pickProfilePhoto(source)
      if (!photo) return

      const photoUrl = await uploadProfilePhoto({
        userId: user.id,
        role: 'serveur',
        photo,
        currentPhotoUrl: serveur.photo_url,
      })

      await saveProfilePhotoUrl('serveur', user.id, photoUrl)
      rafraichirServeurPhoto(photoUrl)
    } catch (error) {
      console.error('serveur profile photo update error', error)
      Alert.alert('Photo de profil', getProfilePhotoErrorMessage(error))
    } finally {
      setPhotoLoading(false)
    }
  }

  const handleRemovePhoto = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user || !serveur?.photo_url) return

    try {
      setPhotoLoading(true)
      await removeProfilePhoto('serveur', user.id, serveur.photo_url)
      rafraichirServeurPhoto(null)
    } catch (error) {
      console.error('serveur profile photo delete error', error)
      Alert.alert('Photo de profil', getProfilePhotoErrorMessage(error))
    } finally {
      setPhotoLoading(false)
    }
  }

  const openPhotoActions = () => {
    if (photoLoading) return

    Alert.alert('Photo de profil', 'Choisissez une action.', [
      { text: 'Prendre une photo', onPress: () => void handlePhotoSelection('camera') },
      { text: 'Choisir depuis la galerie', onPress: () => void handlePhotoSelection('library') },
      ...(serveur?.photo_url
        ? [{ text: 'Supprimer la photo', style: 'destructive' as const, onPress: () => void handleRemovePhoto() }]
        : []),
      { text: 'Annuler', style: 'cancel' },
    ])
  }

  if (loading) {
    return (
      <View style={s.loading}>
        <Text>Chargement...</Text>
      </View>
    )
  }

  const initiales = `${serveur?.prenom?.[0] ?? ''}${serveur?.nom?.[0] ?? ''}`.toUpperCase()
  const totalPresence = (serveur?.missions_realisees ?? 0) + (serveur?.missions_annulees ?? 0)
  const tauxPresence =
    totalPresence > 0
      ? Math.min(100, Math.round((serveur.missions_realisees / totalPresence) * 100))
      : 100
  const completedMissions = serveur?.missions_realisees ?? 0
  const currentBadge = getServeurExperienceBadgeLabel(completedMissions)
  const normalizedCurrentBadge = currentBadge.startsWith('Confirm') ? 'Confirme' : currentBadge
  const badgeLevels = [
    { label: 'Nouveau', missions: '0-3', gain: 'Pas de negociation' },
    { label: 'Confirme', missions: '3-20', gain: '+1€/h max' },
    { label: 'Pro', missions: '20-50', gain: '+2€/h max' },
    { label: 'Expert', missions: '50+', gain: '+3€/h max' },
  ]

  const nextBadge =
    completedMissions < 3
      ? { label: 'Confirme', threshold: 3, gain: '+1€/h' }
      : completedMissions < 20
        ? { label: 'Pro', threshold: 20, gain: '+2€/h' }
        : completedMissions < 50
          ? { label: 'Expert', threshold: 50, gain: '+3€/h' }
          : null
  const missionsToNextBadge = nextBadge ? Math.max(0, nextBadge.threshold - completedMissions) : 0
  const getBadgeIconName = (label: string) => {
    switch (label) {
      case 'Nouveau':
        return 'leaf'
      case 'Confirme':
        return 'shield-outline'
      case 'Pro':
        return 'trending-up'
      case 'Expert':
        return 'ribbon'
      default:
        return 'ellipse'
    }
  }

  const getProgressIconName = (label: string) => {
    switch (label) {
      case 'Nouveau':
        return 'checkmark'
      case 'Confirme':
        return 'shield-outline'
      case 'Pro':
        return 'trending-up'
      case 'Expert':
        return 'ribbon'
      default:
        return 'ellipse'
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <View style={s.header}>
        <View style={s.heroCard}>
          <View style={s.heroAccent} />

          <View style={s.heroRow}>
            <TouchableOpacity onPress={openPhotoActions} activeOpacity={0.85} disabled={photoLoading} style={s.photoTap}>
              {serveur?.photo_url ? (
                <View style={s.photoFrame}>
                  <Image source={{ uri: serveur.photo_url }} style={s.photo} />
                </View>
              ) : (
                <View style={s.photoFrame}>
                  <View style={s.avatar}>
                    <Text style={s.avatarText}>{initiales}</Text>
                  </View>
                </View>
              )}
              <View style={s.photoOverlay}>
                <Text style={s.photoOverlayTxt}>{photoLoading ? '...' : '\u270e'}</Text>
              </View>
              <Text style={s.photoHint}>{photoLoading ? 'Mise a jour...' : ''}</Text>
            </TouchableOpacity>

            <View style={s.heroInfo}>
              <Text style={s.nom}>
                {serveur?.prenom} {serveur?.nom}
              </Text>
              <Text style={s.ville}>{'\u{1F4CD}'} {serveur?.ville || 'Ville non renseignee'}</Text>

              <View style={s.profileBadge}>
                <View style={s.profileBadgeDot} />
                <Text style={s.profileBadgeTxt}>Profil actif</Text>
              </View>
            </View>
          </View>

          <View style={s.summaryGrid}>
            <View style={[s.summaryCard, s.summaryCardPrimary]}>
              <Text style={s.summaryEyebrow}>ACTIVITE</Text>
              <Text style={[s.summaryValue, { color: C.accent }]}>{serveur?.missions_realisees || 0}</Text>
              <Text style={s.summaryLabel}>missions realisees</Text>
            </View>
            <View style={[s.summaryCard, s.summaryCardSecondary]}>
              <Text style={s.summaryEyebrow}>{serveur?.score ? 'NOTE' : 'PRESENCE'}</Text>
              <Text style={s.summaryValueAlt}>
                {serveur?.score ? Number(serveur.score).toFixed(1) : `${tauxPresence}%`}
              </Text>
              <Text style={s.summaryLabelStrong}>{serveur?.score ? 'moyenne' : 'taux de presence'}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.sectionOverline}>PROGRESSION</Text>
        <Text style={s.cardTitle}>Badges et niveaux</Text>
        <Text style={s.badgesLead}>
          Plus vous effectuez de missions avec serieux, plus vous gagnez en marge de negociation.
        </Text>

        <View style={s.badgesSummaryCard}>
          <View style={s.badgesSummaryCol}>
            <Text style={s.badgesSummaryEyebrow}>VOTRE NIVEAU ACTUEL</Text>
            <View style={s.badgesSummaryTopRow}>
              <View style={s.badgesSummaryIconWrap}>
                <Ionicons name="leaf" size={16} color={C.accent} />
              </View>
            </View>
            <Text style={[s.badgesSummaryValue, s.badgesSummaryValueAccent]} numberOfLines={1}>
              {normalizedCurrentBadge}
            </Text>
          </View>
          <View style={s.badgesSummaryDivider} />
          <View style={s.badgesSummaryCol}>
            <Text style={s.badgesSummaryEyebrow}>IL VOUS RESTE</Text>
            <Text style={[s.badgesSummaryValue, s.badgesSummaryValueAccent]}>
              {nextBadge ? `${missionsToNextBadge} mission${missionsToNextBadge > 1 ? 's' : ''}` : '0 mission'}
            </Text>
            <Text style={s.badgesSummaryCaption}>
              {nextBadge ? `pour passer ${nextBadge.label}` : 'niveau maximum atteint'}
            </Text>
          </View>
        </View>

        <View style={s.progressTrack}>
          {badgeLevels.map((item, index) => {
            const currentIndex = badgeLevels.findIndex((level) => level.label === normalizedCurrentBadge)
            const isActive = normalizedCurrentBadge === item.label
            const isReached = currentIndex >= index
            const isNext = !isActive && nextBadge?.label === item.label

            return (
              <View key={`progress-${item.label}`} style={s.progressColumn}>
                <View style={s.progressNodeRow}>
                  {index > 0 ? <View style={[s.progressLine, isReached && s.progressLineActive]} /> : <View style={s.progressLineSpacer} />}
                  <View style={[s.progressCircle, isActive && s.progressCircleActive]}>
                    <Ionicons
                      name={getProgressIconName(item.label)}
                      size={item.label === 'Expert' ? 15 : item.label === 'Pro' ? 15 : 16}
                      color={isActive ? '#FFFCF8' : '#8F877D'}
                    />
                  </View>
                  {index < badgeLevels.length - 1 ? <View style={[s.progressLine, (isReached || isNext) && s.progressLineActive]} /> : <View style={s.progressLineSpacer} />}
                </View>
                <Text style={[s.progressStepLabel, isActive && s.progressStepLabelActive]} numberOfLines={1} ellipsizeMode="tail">
                  {item.label}
                </Text>
                <Text style={s.progressStepMeta} numberOfLines={1} ellipsizeMode="tail">
                  {item.missions}
                </Text>
              </View>
            )
          })}
        </View>

        <View style={s.advantageListCard}>
          {badgeLevels.map((item, index) => {
            const isActive = normalizedCurrentBadge === item.label

            return (
              <View key={`advantage-${item.label}`} style={[s.advantageRow, isActive && s.advantageRowActive, index < badgeLevels.length - 1 && s.advantageRowBorder]}>
                <View style={[s.advantageIconWrap, isActive ? s.advantageIconWrapActive : s.advantageIconWrapLocked]}>
                  <Ionicons
                    name={getBadgeIconName(item.label)}
                    size={item.label === 'Expert' ? 15 : 14}
                    color={isActive ? '#FFFCF8' : item.label === 'Nouveau' ? C.accent : '#8F877D'}
                  />
                </View>
                <View style={s.advantageCopy}>
                  <Text style={s.advantageTitle} numberOfLines={1} ellipsizeMode="tail">{item.label}</Text>
                  <Text style={s.advantageSubtitle} numberOfLines={1} ellipsizeMode="tail">{item.gain}</Text>
                </View>
                <View style={[s.advantageBadge, isActive ? s.advantageBadgeCurrent : s.advantageBadgePending]}>
                  {isActive ? <Text style={s.advantageBadgeCurrentText}>Actuel</Text> : <Text style={s.advantageBadgePendingText}>A debloquer</Text>}
                </View>
              </View>
            )
          })}
        </View>

        <View style={s.infoSoftCard}>
          <Text style={s.infoSoftTitle}>Comment ca marche ?</Text>
          <Text style={s.infoSoftText}>
            Plus vous realisez de missions et maintenez une bonne presence, plus vous debloquez une meilleure marge de negociation sur vos prochains contrats.
          </Text>
        </View>

        <View style={s.infoOutlineCard}>
          <View style={s.infoOutlineHeader}>
            <View style={s.infoOutlineIcon}>
              <Ionicons name="hand-left-outline" size={16} color={C.accent} />
            </View>
            <Text style={s.infoOutlineTitle}>Vous pouvez negocier votre tarif dans cette limite.</Text>
          </View>
          <Text style={s.infoOutlineText}>Ce n'est pas un salaire garanti.</Text>
        </View>

        <View style={s.conditionsPremiumCard}>
          <Text style={s.conditionsPremiumTitle}>CONDITIONS POUR PROGRESSER</Text>
          <View style={s.conditionItem}>
            <View style={s.conditionIconWrap}><Ionicons name="time-outline" size={15} color={C.accent} /></View>
            <View style={s.conditionCopy}>
              <Text style={s.conditionLabel}>Presence minimum 90%</Text>
              <Text style={s.conditionSubtext}>Check-in et check-out a l'heure</Text>
            </View>
          </View>
          <View style={s.conditionItem}>
            <View style={s.conditionIconWrap}><Ionicons name="star-outline" size={14} color={C.amber} /></View>
            <View style={s.conditionCopy}>
              <Text style={s.conditionLabel}>Note minimum 4/5</Text>
              <Text style={s.conditionSubtext}>Donnee par les restaurants</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={[s.card, s.firstCard]}>
        <Text style={s.sectionOverline}>PROFIL</Text>
        <Text style={s.cardTitle}>Ma presentation</Text>
        <Text style={s.bioText}>
          {serveur?.description?.trim()
            ? serveur.description
            : 'Ajoutez une courte presentation pour aider les patrons a mieux vous choisir.'}
        </Text>
      </View>

      <View style={s.card}>
        <View style={s.cardRowHeader}>
          <Text style={s.cardTitle}>Mes experiences</Text>
          <TouchableOpacity onPress={() => router.push('/modifier-profil-serveur')} activeOpacity={0.75}>
            <Text style={s.cardLink}>Modifier</Text>
          </TouchableOpacity>
        </View>

        <View style={s.expList}>
          {experiences.length ? (
            <>
              {(showAllExperiences ? experiences : experiences.slice(0, 1)).map((experience, index) => (
                <View key={experience.id ?? `${experience.poste}-${index}`} style={s.expItem}>
                  <Text style={s.expTxt}>{formatServeurExperience(experience)}</Text>
                </View>
              ))}
              {!showAllExperiences && experiences.length > 1 ? (
                <View style={s.expMoreRow}>
                  <TouchableOpacity onPress={() => setShowAllExperiences(true)} activeOpacity={0.75}>
                    <Text style={s.cardLink}>Voir toutes les experiences</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {showAllExperiences && experiences.length > 1 ? (
                <TouchableOpacity onPress={() => setShowAllExperiences(false)} activeOpacity={0.75} style={s.expCollapseBtn}>
                  <Text style={s.cardLink}>Voir moins</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : (
            <Text style={s.emptyTxt}>Ajoutez vos premieres experiences pour rassurer les patrons.</Text>
          )}
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>Mes infos</Text>
        <Text style={s.infoTxt}>Email : {serveur?.email || 'Non renseigne'}</Text>
        <Text style={s.infoTxt}>Telephone : {serveur?.telephone || 'Non renseigne'}</Text>
        <Text style={s.infoTxt}>Ville : {serveur?.ville || 'Non renseignee'}</Text>
      </View>

      <TouchableOpacity style={s.editBtn} onPress={() => router.push('/modifier-profil-serveur')} activeOpacity={0.8}>
        <Text style={s.editBtnTxt}>Modifier mon profil</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.referralCard} activeOpacity={0.82} onPress={() => router.push('/parrainage')}>
        <View style={{ flex: 1 }}>
          <Text style={s.referralTitle}>Parrainage</Text>
          <Text style={s.referralSub}>Invitez un proche et profitez d'avantages.</Text>
        </View>
        <Text style={s.referralArrow}>{'>'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.logoutBtn} onPress={handleDeconnexion} activeOpacity={0.7}>
        <Text style={s.logoutTxt}>Se deconnecter</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingBottom: 132 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingTop: 36, paddingHorizontal: 16, paddingBottom: 0 },
  heroCard: {
    backgroundColor: C.card,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 20,
    shadowColor: '#120E0A',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    elevation: 3,
  },
  heroAccent: { width: 72, height: 6, borderRadius: 999, backgroundColor: '#EEF7F1', borderWidth: 1, borderColor: '#D1E2D5', marginBottom: 20 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 20 },
  photoTap: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  photoFrame: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: '#F7FBF8',
    borderWidth: 1,
    borderColor: '#D9E5DD',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F4939',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 3,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#EEF7F1',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#D6E3DA',
  },
  photo: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: '#D6E3DA',
    backgroundColor: '#EEF7F1',
  },
  avatarText: { fontSize: 32, fontWeight: '800', color: C.accent },
  photoHint: { display: 'none' },
  photoOverlay: { position: 'absolute', right: 4, bottom: 4, width: 32, height: 32, borderRadius: 16, backgroundColor: '#171614', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.card },
  photoOverlayTxt: { fontSize: 12, color: '#fff', fontWeight: '800' },
  heroInfo: { flex: 1 },
  nom: { fontSize: 29, fontWeight: '800', color: C.title, letterSpacing: -0.7, lineHeight: 33, marginBottom: 6 },
  ville: { fontSize: 13, color: C.textSoft, marginBottom: 12, fontWeight: '600' },
  profileBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#EEF7F1', borderWidth: 1, borderColor: '#D1E2D5', alignSelf: 'flex-start' },
  profileBadgeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.accent },
  profileBadgeTxt: { fontSize: 12, color: C.accent, fontWeight: '800' },
  summaryGrid: { flexDirection: 'row', gap: 12, width: '100%' },
  summaryCard: { flex: 1, borderRadius: 24, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 18, minHeight: 124 },
  summaryCardPrimary: { backgroundColor: '#FAF6EF', borderColor: '#EEE4D7' },
  summaryCardSecondary: { backgroundColor: '#F2F8F3', borderColor: '#D6E3DA' },
  summaryEyebrow: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.1, color: C.textMuted, fontWeight: '800', marginBottom: 10 },
  summaryValue: { fontSize: 30, fontWeight: '800', color: C.title, marginBottom: 4, letterSpacing: -0.8 },
  summaryValueAlt: { fontSize: 26, fontWeight: '800', color: C.title, marginBottom: 6, letterSpacing: -0.6 },
  summaryLabel: { fontSize: 12, color: C.textSoft, fontWeight: '600', lineHeight: 16 },
  summaryLabelStrong: { fontSize: 13, color: C.accent, fontWeight: '700' },
  badgesLead: { fontSize: 14, lineHeight: 20, color: C.textSoft, fontWeight: '600', marginBottom: 16 },
  badgesSummaryCard: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: '#F8F2E8', borderWidth: 1, borderColor: C.borderSoft, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 16, marginBottom: 18 },
  badgesSummaryCol: { flex: 1 },
  badgesSummaryDivider: { width: 1, backgroundColor: '#E7DCCD', marginHorizontal: 14 },
  badgesSummaryEyebrow: { fontSize: 11, color: C.textMuted, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  badgesSummaryTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  badgesSummaryIconWrap: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#EAF5EE', borderWidth: 1, borderColor: '#D1E2D5', alignItems: 'center', justifyContent: 'center' },
  badgesSummaryValue: { fontSize: 22, color: C.title, fontWeight: '800', letterSpacing: -0.4 },
  badgesSummaryValueAccent: { color: C.accent },
  badgesSummaryCaption: { marginTop: 4, fontSize: 13, color: C.textSoft, fontWeight: '600', lineHeight: 18 },
  progressTrack: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 },
  progressColumn: { flex: 1, alignItems: 'center' },
  progressNodeRow: { width: '100%', flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  progressLineSpacer: { flex: 1 },
  progressLine: { flex: 1, height: 2, backgroundColor: '#DCCFC0' },
  progressLineActive: { backgroundColor: '#D1E2D5' },
  progressCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F1E9DE', borderWidth: 1, borderColor: '#DCCFC0', alignItems: 'center', justifyContent: 'center' },
  progressCircleActive: { backgroundColor: C.accent, borderColor: C.accent },
  progressStepLabel: { fontSize: 12, color: C.title, fontWeight: '800', textAlign: 'center', flexShrink: 1, width: '100%', minWidth: 0 },
  progressStepLabelActive: { color: C.accent },
  progressStepMeta: { marginTop: 6, fontSize: 9, color: C.textSoft, fontWeight: '700', textAlign: 'center', lineHeight: 12, flexShrink: 1, width: '100%', minWidth: 0 },
  infoSoftCard: { backgroundColor: '#F8F2E8', borderWidth: 1, borderColor: C.borderSoft, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12 },
  infoSoftTitle: { fontSize: 15, color: C.title, fontWeight: '800', marginBottom: 6 },
  infoSoftText: { fontSize: 13, lineHeight: 19, color: C.textSoft, fontWeight: '600' },
  infoOutlineCard: { backgroundColor: '#F7FBF8', borderWidth: 1, borderColor: '#CFE3D6', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12 },
  infoOutlineHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  infoOutlineIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EAF5EE', alignItems: 'center', justifyContent: 'center' },
  infoOutlineTitle: { flex: 1, fontSize: 14, color: C.accent, fontWeight: '800', marginBottom: 4 },
  infoOutlineText: { fontSize: 13, lineHeight: 18, color: C.textSoft, fontWeight: '600' },
  conditionsPremiumCard: { backgroundColor: '#FFFCF8', borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 14 },
  conditionsPremiumTitle: { fontSize: 11, color: C.textMuted, fontWeight: '800', letterSpacing: 0.8, marginBottom: 12 },
  advantageListCard: { backgroundColor: '#FFFCF8', borderWidth: 1, borderColor: C.border, borderRadius: 20, overflow: 'hidden', marginBottom: 14 },
  advantageRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, gap: 12 },
  advantageRowActive: { backgroundColor: '#EEF7F1' },
  advantageRowBorder: { borderBottomWidth: 1, borderBottomColor: '#EFE7DB' },
  advantageIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  advantageIconWrapActive: { backgroundColor: C.accent },
  advantageIconWrapLocked: { backgroundColor: '#F1E9DE', borderWidth: 1, borderColor: '#E2D5C7' },
  advantageCopy: { flex: 1, minWidth: 0 },
  advantageTitle: { fontSize: 14, color: C.title, fontWeight: '800', flexShrink: 1 },
  advantageSubtitle: { marginTop: 2, fontSize: 13, color: C.terra, fontWeight: '800', flexShrink: 1 },
  advantageBadge: { minWidth: 92, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  advantageBadgeCurrent: { backgroundColor: '#DDEFE4' },
  advantageBadgePending: { backgroundColor: '#F3EEE6', borderWidth: 1, borderColor: '#E2D5C7' },
  advantageBadgeCurrentText: { fontSize: 12, color: C.accent, fontWeight: '800' },
  advantageBadgePendingText: { fontSize: 11, color: '#8F877D', fontWeight: '700' },
  progressMessageCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#EEF7F1', borderWidth: 1, borderColor: '#D1E2D5', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 },
  progressMessageIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#DDEFE4', alignItems: 'center', justifyContent: 'center' },
  progressMessageText: { flex: 1, fontSize: 13, lineHeight: 18, color: C.accent, fontWeight: '700' },
  conditionIconWrap: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F4EEE4', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  conditionItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  conditionCopy: { flex: 1, paddingBottom: 10 },
  conditionLabel: { fontSize: 13, color: C.title, fontWeight: '700', marginBottom: 2 },
  conditionSubtext: { fontSize: 12, color: C.textSoft, lineHeight: 17, fontWeight: '600' },
  firstCard: { marginTop: 30 },
  card: {
    backgroundColor: C.card,
    margin: 16,
    marginBottom: 0,
    padding: 20,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: '#120E0A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
    elevation: 2,
  },
  sectionOverline: {
    fontSize: 10,
    color: C.textMuted,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  cardTitle: { fontSize: 21, fontWeight: '800', color: C.title, marginBottom: 12, letterSpacing: -0.3 },
  bioText: { fontSize: 14, color: C.textSoft, lineHeight: 22 },
  cardRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardLink: { fontSize: 13, color: C.accent, fontWeight: '800' },
  expList: { gap: 10 },
  expItem: {
    backgroundColor: '#FAF6EF',
    borderWidth: 1,
    borderColor: '#EEE4D7',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  expTxt: { fontSize: 13, lineHeight: 19, color: C.title, fontWeight: '600' },
  expMoreRow: {
    backgroundColor: '#FFFCF8',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  expMoreTxt: { flex: 1, fontSize: 13, color: C.textSoft, fontWeight: '700' },
  expCollapseBtn: { alignSelf: 'flex-start', marginTop: 2 },
  emptyTxt: { fontSize: 13, color: C.textSoft, lineHeight: 20 },
  infoTxt: { fontSize: 14, color: C.textSoft, marginBottom: 8, lineHeight: 20 },
  editBtn: {
    margin: 16,
    marginBottom: 0,
    padding: 16,
    borderRadius: 18,
    alignItems: 'center',
    backgroundColor: C.accent,
    shadowColor: C.accent,
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 2,
  },
  editBtnTxt: { fontSize: 15, color: '#fff', fontWeight: '800' },
  referralCard: {
    backgroundColor: '#F2F8F3',
    margin: 16,
    marginBottom: 0,
    padding: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#D6E3DA',
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#120E0A',
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 1,
    justifyContent: 'space-between',
  },
  referralTitle: { fontSize: 16, fontWeight: '800', color: C.title, marginBottom: 3 },
  referralSub: { fontSize: 12, color: C.textSoft },
  referralArrow: { fontSize: 22, color: C.accent, marginLeft: 8, fontWeight: '800' },
  logoutBtn: {
    margin: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 18,
    alignItems: 'center',
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: C.red,
    marginBottom: 8,
  },
  logoutTxt: { fontSize: 15, color: C.red, fontWeight: '700' },
})
