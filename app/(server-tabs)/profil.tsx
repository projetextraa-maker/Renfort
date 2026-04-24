import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
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
    Alert.alert('Se déconnecter', 'Voulez-vous vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Se déconnecter',
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
  const badgeLevels = [
    { label: 'Nouveau', missions: '0 a 3 missions confirmees', gain: '0€/h' },
    { label: 'Confirme', missions: '3 a 20 missions confirmees', gain: '+1€/h' },
    { label: 'Pro', missions: '20 a 50 missions confirmees', gain: '+2€/h' },
    { label: 'Expert', missions: 'Plus de 50 missions confirmees', gain: '+3€/h' },
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
              <Text style={s.photoHint}>{photoLoading ? 'Mise à jour...' : ''}</Text>
            </TouchableOpacity>

            <View style={s.heroInfo}>
              <Text style={s.nom}>
                {serveur?.prenom} {serveur?.nom}
              </Text>
              <Text style={s.ville}>{'\u{1F4CD}'} {serveur?.ville || 'Ville non renseignée'}</Text>

              <View style={s.profileBadge}>
                <View style={s.profileBadgeDot} />
                <Text style={s.profileBadgeTxt}>Profil actif</Text>
              </View>
            </View>
          </View>

          <View style={s.summaryGrid}>
            <View style={[s.summaryCard, s.summaryCardPrimary]}>
              <Text style={s.summaryEyebrow}>ACTIVITÉ</Text>
              <Text style={[s.summaryValue, { color: C.accent }]}>{serveur?.missions_realisees || 0}</Text>
              <Text style={s.summaryLabel}>missions réalisées</Text>
            </View>
            <View style={[s.summaryCard, s.summaryCardSecondary]}>
              <Text style={s.summaryEyebrow}>{serveur?.score ? 'NOTE' : 'PRÉSENCE'}</Text>
              <Text style={s.summaryValueAlt}>
                {serveur?.score ? Number(serveur.score).toFixed(1) : `${tauxPresence}%`}
              </Text>
              <Text style={s.summaryLabelStrong}>{serveur?.score ? 'moyenne' : 'taux de présence'}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.sectionOverline}>AVANTAGES</Text>
        <Text style={s.cardTitle}>Badges et avantages</Text>
        <Text style={s.badgesIntro}>Votre badge actuel : {currentBadge}</Text>

        <View style={s.badgeGrid}>
          {badgeLevels.map((item) => {
            const isActive =
              currentBadge === item.label ||
              (currentBadge === 'Confirmé' && item.label === 'Confirme')

            return (
              <View key={`grid-${item.label}`} style={[s.badgeCard, isActive && s.badgeCardActive, !isActive && nextBadge?.label === item.label && s.badgeCardNext]}>
                <Text style={[s.badgeCardTitle, isActive && s.badgeCardTitleActive]}>{item.label}</Text>
                <Text style={[s.badgeCardMeta, isActive && s.badgeCardMetaActive]}>
                  {item.missions.replace(' confirmees', '').replace('Plus de ', '').replace(' a ', '–')}
                </Text>
                <Text style={s.badgeCardSubmeta}>confirmées</Text>
                <Text style={[s.badgeCardGain, isActive && s.badgeCardGainActive]}>{item.gain}</Text>
              </View>
            )
          })}
        </View>

        {nextBadge ? (
          <Text style={s.badgeProgressText}>
            Encore {missionsToNextBadge} mission{missionsToNextBadge > 1 ? 's' : ''} pour passer {nextBadge.label} ({nextBadge.gain})
          </Text>
        ) : null}

        <View style={s.conditionsCompactBox}>
          <Text style={s.conditionsTitle}>Conditions :</Text>
          <Text style={s.conditionsText}>• ≥90% présence</Text>
          <Text style={s.conditionsText}>• Note ≥ 4</Text>
        </View>

        <View style={s.progressTrack}>
          {[
            { label: 'Nouveau', gain: '0€/h' },
            { label: 'Confirmé', gain: '+1€/h' },
            { label: 'Pro', gain: '+2€/h' },
            { label: 'Expert', gain: '+3€/h' },
          ].map((item, index, array) => (
            <View key={item.label} style={s.progressStepWrap}>
              {index > 0 ? <View style={s.progressLine} /> : null}
              <View style={[s.progressStep, currentBadge === item.label && s.progressStepActive]}>
                <Text style={[s.progressStepLabel, currentBadge === item.label && s.progressStepLabelActive]}>
                  {item.label}
                </Text>
                <Text style={[s.progressStepGain, currentBadge === item.label && s.progressStepGainActive]}>
                  {item.gain}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <View style={s.conditionsBox}>
          <Text style={s.conditionsText}>Présence ≥ 90% sur les 10 dernières missions</Text>
          <Text style={s.conditionsText}>Note ≥ 4 pour débloquer la négociation</Text>
        </View>
      </View>

      <View style={[s.card, s.firstCard]}>
        <Text style={s.sectionOverline}>PROFIL</Text>
        <Text style={s.cardTitle}>Ma présentation</Text>
        <Text style={s.bioText}>
          {serveur?.description?.trim()
            ? serveur.description
            : 'Ajoutez une courte présentation pour aider les patrons à mieux vous choisir.'}
        </Text>
      </View>

      <View style={s.card}>
        <View style={s.cardRowHeader}>
          <Text style={s.cardTitle}>Mes expériences</Text>
          <TouchableOpacity onPress={() => router.push('/modifier-profil-serveur')} activeOpacity={0.75}>
            <Text style={s.cardLink}>Modifier</Text>
          </TouchableOpacity>
        </View>

        <View style={s.expList}>
          {experiences.length ? (
            experiences.map((experience, index) => (
              <View key={experience.id ?? `${experience.poste}-${index}`} style={s.expItem}>
                <Text style={s.expTxt}>{formatServeurExperience(experience)}</Text>
              </View>
            ))
          ) : (
            <Text style={s.emptyTxt}>Ajoutez vos premières expériences pour rassurer les patrons.</Text>
          )}
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>Mes infos</Text>
        <Text style={s.infoTxt}>Email : {serveur?.email || 'Non renseigné'}</Text>
        <Text style={s.infoTxt}>Téléphone : {serveur?.telephone || 'Non renseigné'}</Text>
        <Text style={s.infoTxt}>Ville : {serveur?.ville || 'Non renseignée'}</Text>
      </View>

      <TouchableOpacity style={s.editBtn} onPress={() => router.push('/modifier-profil-serveur')} activeOpacity={0.8}>
        <Text style={s.editBtnTxt}>Modifier mon profil</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.referralCard} activeOpacity={0.82} onPress={() => router.push('/parrainage')}>
        <View style={{ flex: 1 }}>
          <Text style={s.referralTitle}>Parrainage</Text>
          <Text style={s.referralSub}>Invitez un proche et profitez d’avantages.</Text>
        </View>
        <Text style={s.referralArrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.logoutBtn} onPress={handleDeconnexion} activeOpacity={0.7}>
        <Text style={s.logoutTxt}>Se déconnecter</Text>
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
  badgesIntro: { fontSize: 14, color: C.title, fontWeight: '700', marginBottom: 14 },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginBottom: 14 },
  badgeCard: {
    width: '48.3%',
    minHeight: 96,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E8DED0',
    backgroundColor: '#FAF6EF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'space-between',
  },
  badgeCardActive: { backgroundColor: '#EEF7F1', borderColor: '#D1E2D5' },
  badgeCardNext: { borderColor: '#E3C78D', backgroundColor: '#FCF6EA' },
  badgeCardTitle: { fontSize: 13, color: C.title, fontWeight: '800' },
  badgeCardTitleActive: { color: C.accent },
  badgeCardMeta: { marginTop: 6, fontSize: 11, lineHeight: 15, color: C.textSoft, fontWeight: '700' },
  badgeCardMetaActive: { color: '#35684E' },
  badgeCardSubmeta: { marginTop: 1, fontSize: 10, lineHeight: 13, color: C.textMuted, fontWeight: '600' },
  badgeCardGain: { marginTop: 8, fontSize: 14, color: C.terra, fontWeight: '800' },
  badgeCardGainActive: { color: C.accent },
  badgeProgressText: { marginTop: -2, marginBottom: 12, fontSize: 13, lineHeight: 18, color: C.accent, fontWeight: '700' },
  progressTrack: { display: 'none', flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-between', marginBottom: 14 },
  progressStepWrap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  progressLine: { flex: 1, height: 1, backgroundColor: '#DCCFC0', marginHorizontal: 4 },
  progressStep: { minHeight: 66, minWidth: 68, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 16, borderWidth: 1, borderColor: '#E8DED0', backgroundColor: '#FAF6EF', alignItems: 'center', justifyContent: 'center' },
  progressStepActive: { backgroundColor: '#EEF7F1', borderColor: '#D1E2D5' },
  progressStepLabel: { fontSize: 11, color: C.title, fontWeight: '800', textAlign: 'center' },
  progressStepLabelActive: { color: C.accent },
  progressStepGain: { marginTop: 6, fontSize: 11, color: C.textSoft, fontWeight: '700', textAlign: 'center' },
  progressStepGainActive: { color: C.accent },
  conditionsCompactBox: { backgroundColor: '#F8F2E8', borderWidth: 1, borderColor: C.borderSoft, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 2 },
  conditionsBox: { display: 'none', backgroundColor: '#F8F2E8', borderWidth: 1, borderColor: C.borderSoft, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  conditionsTitle: { fontSize: 12, color: C.title, fontWeight: '800', marginBottom: 4 },
  conditionsText: { fontSize: 13, color: C.textSoft, lineHeight: 18, fontWeight: '600' },
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
