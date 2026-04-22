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
import { computeServeurMissionStatsFromAnnonces } from '../../lib/serveur-stats'
import { supabase } from '../../lib/supabase'

const C = {
  bg: '#F7F4EE',
  card: '#FFFFFF',
  cardSoft: '#F4EFE7',
  border: '#E6DED2',
  borderSoft: '#EFE7DB',
  title: '#171614',
  textSoft: '#6D675E',
  textMuted: '#9A9388',
  accent: '#2E8B57',
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
              <Text style={s.photoHint}>{photoLoading ? 'Mise \u00e0 jour...' : ''}</Text>
            </TouchableOpacity>

            <View style={s.heroInfo}>
              <Text style={s.nom}>
                {serveur?.prenom} {serveur?.nom}
              </Text>
              <Text style={s.ville}>{'\u{1F4CD}'} {serveur?.ville || 'Ville non renseign\u00e9e'}</Text>

              <View style={s.profileBadge}>
                <View style={s.profileBadgeDot} />
                <Text style={s.profileBadgeTxt}>Profil actif</Text>
              </View>
            </View>
          </View>

          <View style={s.summaryGrid}>
            <View style={[s.summaryCard, s.summaryCardPrimary]}>
              <Text style={s.summaryEyebrow}>Activit\u00e9</Text>
              <Text style={[s.summaryValue, { color: C.accent }]}>{serveur?.missions_realisees || 0}</Text>
              <Text style={s.summaryLabel}>missions r\u00e9alis\u00e9es</Text>
            </View>
            <View style={[s.summaryCard, s.summaryCardSecondary]}>
              <Text style={s.summaryEyebrow}>{serveur?.score ? 'Note' : 'Pr\u00e9sence'}</Text>
              <Text style={s.summaryValueAlt}>
                {serveur?.score ? Number(serveur.score).toFixed(1) : `${tauxPresence}%`}
              </Text>
              <Text style={s.summaryLabelStrong}>{serveur?.score ? 'moyenne' : 'taux de pr\u00e9sence'}</Text>
            </View>
          </View>
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
        <View style={s.referralIcon}>
          <Text style={s.referralIconText}>%</Text>
        </View>
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
  content: { paddingBottom: 128 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingTop: 34, paddingHorizontal: 16, paddingBottom: 0 },
  heroCard: {
    backgroundColor: C.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 18,
    shadowColor: '#120E0A',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 24,
    elevation: 4,
  },
  heroAccent: { width: 68, height: 6, borderRadius: 999, backgroundColor: '#E8F5ED', borderWidth: 1, borderColor: '#CFE7D8', marginBottom: 18 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 18 },
  photoTap: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  photoFrame: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: '#F4FBF7',
    borderWidth: 1,
    borderColor: '#CFE7D8',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F4939',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 4,
  },
  avatar: {
    width: 98,
    height: 98,
    borderRadius: 49,
    backgroundColor: '#E8F5ED',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#CFE7D8',
  },
  photo: {
    width: 98,
    height: 98,
    borderRadius: 49,
    borderWidth: 1.5,
    borderColor: '#CFE7D8',
    backgroundColor: '#E8F5ED',
  },
  avatarText: { fontSize: 32, fontWeight: '800', color: C.accent },
  photoHint: { display: 'none' },
  photoOverlay: { position: 'absolute', right: 4, bottom: 4, width: 30, height: 30, borderRadius: 15, backgroundColor: '#171614', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.card },
  photoOverlayTxt: { fontSize: 12, color: '#fff', fontWeight: '800' },
  heroInfo: { flex: 1 },
  nom: { fontSize: 28, fontWeight: '800', color: C.title, letterSpacing: -0.5, marginBottom: 6 },
  ville: { fontSize: 13, color: C.textSoft, marginBottom: 12, fontWeight: '600' },
  profileBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#F0F8F3', borderWidth: 1, borderColor: '#CFE7D8', alignSelf: 'flex-start' },
  profileBadgeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.accent },
  profileBadgeTxt: { fontSize: 12, color: C.accent, fontWeight: '800' },
  summaryGrid: { flexDirection: 'row', gap: 12, width: '100%' },
  summaryCard: { flex: 1, borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 16 },
  summaryCardPrimary: { backgroundColor: C.cardSoft, borderColor: C.borderSoft },
  summaryCardSecondary: { backgroundColor: '#F0F8F3', borderColor: '#CFE7D8' },
  summaryEyebrow: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.1, color: C.textMuted, fontWeight: '700', marginBottom: 10 },
  summaryValue: { fontSize: 28, fontWeight: '800', color: C.title, marginBottom: 4, letterSpacing: -0.6 },
  summaryValueAlt: { fontSize: 24, fontWeight: '800', color: C.title, marginBottom: 6, letterSpacing: -0.5 },
  summaryLabel: { fontSize: 12, color: C.textSoft, fontWeight: '600', lineHeight: 16 },
  summaryLabelStrong: { fontSize: 13, color: C.accent, fontWeight: '700' },
  firstCard: { marginTop: 28 },
  card: {
    backgroundColor: C.card,
    margin: 16,
    marginBottom: 0,
    padding: 16,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionOverline: {
    fontSize: 10,
    color: C.textMuted,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: C.title, marginBottom: 10 },
  bioText: { fontSize: 14, color: C.textSoft, lineHeight: 21 },
  cardRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardLink: { fontSize: 13, color: C.terra, fontWeight: '700' },
  expList: { gap: 8 },
  expItem: {
    backgroundColor: C.cardSoft,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  expTxt: { fontSize: 13, lineHeight: 18, color: C.title, fontWeight: '600' },
  emptyTxt: { fontSize: 13, color: C.textSoft, lineHeight: 19 },
  infoTxt: { fontSize: 14, color: C.textSoft, marginBottom: 6 },
  editBtn: {
    margin: 16,
    marginBottom: 0,
    padding: 15,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: C.accent,
  },
  editBtnTxt: { fontSize: 15, color: '#fff', fontWeight: '700' },
  referralCard: {
    backgroundColor: '#FFF8F1',
    margin: 16,
    marginBottom: 0,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8CBB2',
    flexDirection: 'row',
    alignItems: 'center',
  },
  referralIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#F4E2D4',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  referralIconText: { fontSize: 16, fontWeight: '800', color: C.terra },
  referralTitle: { fontSize: 15, fontWeight: '700', color: C.title, marginBottom: 3 },
  referralSub: { fontSize: 12, color: C.textSoft },
  referralArrow: { fontSize: 22, color: C.terra, marginLeft: 8, fontWeight: '800' },
  logoutBtn: {
    margin: 16,
    marginTop: 12,
    padding: 15,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: C.red,
    marginBottom: 8,
  },
  logoutTxt: { fontSize: 15, color: C.red, fontWeight: '600' },
})
