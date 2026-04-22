import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Image, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import PatronBottomNav from '../components/PatronBottomNav'
import { getPatronPlanOffer } from '../lib/billing'
import { EURO } from '../lib/currency'
import { fetchEtablissementsForPatron, getDefaultEtablissement } from '../lib/etablissements'
import {
  getProfilePhotoErrorMessage,
  pickProfilePhoto,
  removeProfilePhoto,
  saveProfilePhotoUrl,
  uploadProfilePhoto,
} from '../lib/profile-photo'
import { isActiveSubscription, syncPatronSubscriptionCycle } from '../lib/subscription'
import { supabase } from '../lib/supabase'

const C = {
  bg: '#F7F4EE',
  card: '#FFFFFF',
  border: '#E6DED2',
  borderSoft: '#EFE7DB',
  title: '#171614',
  text: '#2A2723',
  textSoft: '#6D675E',
  textMuted: '#9A9388',
  terra: '#C46A3C',
  terraBg: '#FEF3EB',
  terraBd: '#F5C9A9',
  green: '#2E8B57',
  greenBg: '#F0F8F3',
  greenBd: '#C0DEC8',
  amber: '#B8893C',
  amberBg: '#FBF5E8',
  amberBd: '#E8D4A0',
  red: '#C84B4B',
}

const FR = {
  loading: 'Chargement...',
  back: 'Retour',
  cancel: 'Annuler',
  logout: 'Se déconnecter',
  logoutConfirm: 'Voulez-vous vous déconnecter ?',
  profilePhoto: 'Photo de profil',
  profilePhotoBody: 'Choisissez une action.',
  takePhoto: 'Prendre une photo',
  pickGallery: 'Choisir depuis la galerie',
  removePhoto: 'Supprimer la photo',
  photoUpdating: 'Mise à jour...',
  cityUnknown: 'Ville non renseignée',
  subscription: 'Abonnement',
  noSubscription: 'Sans abonnement',
  subscribed: 'Abonné',
  info: 'Informations',
  infoPrenom: 'Prénom',
  infoEmail: 'Email',
  infoPhone: 'Téléphone',
  noVenue: 'Aucun',
  myRestaurant: 'Mon établissement',
  seeOffers: 'Voir les offres',
  activeSubscriptionDesc: 'Votre abonnement est actif et prêt pour vos prochaines missions.',
  pausedSubscriptionDesc: 'Votre abonnement est en pause. Réactivez-le depuis les offres quand vous le souhaitez.',
  noSubscriptionDesc: `Vous êtes actuellement à l'acte, à 10${EURO} par mission réalisée.`,
  editProfile: 'Modifier mon profil',
  manageVenues: 'Gérer mes établissements',
  addVenue: 'Ajouter un établissement',
  actions: 'Actions',
}

function buildSubscriptionLabel(subscription: string | null | undefined): string {
  if (subscription === 'pro_pause' || subscription === 'pro_plus_pause') {
    return 'En pause'
  }

  const offer = getPatronPlanOffer(subscription)
  return `${offer.title} · ${offer.priceLabel}`
}

export default function ProfilPatron() {
  const router = useRouter()
  const [patron, setPatron] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [photoLoading, setPhotoLoading] = useState(false)
  const [etablissementCount, setEtablissementCount] = useState(0)
  const [defaultEtablissement, setDefaultEtablissement] = useState<any>(null)

  useEffect(() => {
    void chargerProfil()
  }, [])

  const chargerProfil = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase.from('patrons').select('*').eq('id', user.id).single()
    if (!error && data) {
      await syncPatronSubscriptionCycle(user.id)
      const { data: fresh } = await supabase.from('patrons').select('*').eq('id', user.id).single()
      setPatron(fresh ?? data)

      const etablissements = await fetchEtablissementsForPatron(user.id)
      setEtablissementCount(etablissements.length)
      setDefaultEtablissement(getDefaultEtablissement(etablissements))
    }

    setLoading(false)
  }

  const handleDeconnexion = async () => {
    Alert.alert(FR.logout, FR.logoutConfirm, [
      { text: FR.cancel, style: 'cancel' },
      {
        text: FR.logout,
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut()
          router.push('/')
        },
      },
    ])
  }

  const rafraichirPatronPhoto = (photoUrl: string | null) => {
    setPatron((current: any) => (current ? { ...current, photo_url: photoUrl } : current))
  }

  const handlePhotoSelection = async (source: 'camera' | 'library') => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user || !patron) return

    try {
      setPhotoLoading(true)
      const photo = await pickProfilePhoto(source)
      if (!photo) return

      const photoUrl = await uploadProfilePhoto({
        userId: user.id,
        role: 'patron',
        photo,
        currentPhotoUrl: patron.photo_url,
      })

      await saveProfilePhotoUrl('patron', user.id, photoUrl)
      rafraichirPatronPhoto(photoUrl)
    } catch (error) {
      console.error('patron profile photo update error', error)
      Alert.alert(FR.profilePhoto, getProfilePhotoErrorMessage(error))
    } finally {
      setPhotoLoading(false)
    }
  }

  const handleRemovePhoto = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user || !patron?.photo_url) return

    try {
      setPhotoLoading(true)
      await removeProfilePhoto('patron', user.id, patron.photo_url)
      rafraichirPatronPhoto(null)
    } catch (error) {
      console.error('patron profile photo delete error', error)
      Alert.alert(FR.profilePhoto, getProfilePhotoErrorMessage(error))
    } finally {
      setPhotoLoading(false)
    }
  }

  const openPhotoActions = () => {
    if (photoLoading) return

    Alert.alert(FR.profilePhoto, FR.profilePhotoBody, [
      { text: FR.takePhoto, onPress: () => void handlePhotoSelection('camera') },
      { text: FR.pickGallery, onPress: () => void handlePhotoSelection('library') },
      ...(patron?.photo_url
        ? [{ text: FR.removePhoto, style: 'destructive' as const, onPress: () => void handleRemovePhoto() }]
        : []),
      { text: FR.cancel, style: 'cancel' },
    ])
  }

  if (loading) {
    return (
      <View style={s.loadWrap}>
        <Text style={{ color: C.textMuted }}>{FR.loading}</Text>
      </View>
    )
  }

  const subscription = patron?.abonnement
  const hasActive = isActiveSubscription(subscription)
  const isPaused = subscription === 'pro_pause' || subscription === 'pro_plus_pause'
  const currentOffer = getPatronPlanOffer(subscription)
  const statusLabel = subscription === 'pro_plus' ? 'Pro+' : subscription === 'pro' ? 'Pro' : isPaused ? FR.subscribed : FR.noSubscription
  const subscriptionLabel = buildSubscriptionLabel(subscription)
  const venueLabel = defaultEtablissement?.nom ?? patron?.nom_restaurant ?? FR.myRestaurant
  const initials = venueLabel?.[0]?.toUpperCase() ?? patron?.prenom?.[0]?.toUpperCase() ?? '?'

  const statusColor = hasActive ? C.green : isPaused ? C.amber : C.textMuted
  const statusStyle = hasActive ? s.statusBadgeActive : isPaused ? s.statusBadgePaused : s.statusBadgeInactive
  const subscriptionDescription = hasActive
    ? currentOffer.commissionLabel
    : isPaused
      ? FR.pausedSubscriptionDesc
      : `${currentOffer.priceLabel} · ${currentOffer.commissionLabel}`

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.backTxt}>{FR.back}</Text>
          </TouchableOpacity>

          <View style={s.heroCard}>
            <View style={s.heroRow}>
              <TouchableOpacity
                style={s.avatarTap}
                onPress={openPhotoActions}
                activeOpacity={0.85}
                disabled={photoLoading}
              >
                {patron?.photo_url ? (
                  <View style={s.avatarFrame}>
                    <Image source={{ uri: patron.photo_url }} style={s.avatarImage} />
                  </View>
                ) : (
                  <View style={s.avatarFrame}>
                    <View style={s.avatar}>
                      <Text style={s.avatarTxt}>{initials}</Text>
                    </View>
                  </View>
                )}
                <View style={s.avatarOverlay}>
                  <Text style={s.avatarOverlayTxt}>{photoLoading ? '...' : '\u270e'}</Text>
                </View>
              </TouchableOpacity>

              <View style={s.heroInfo}>
                <Text style={s.nom}>{venueLabel}</Text>
                <Text style={s.ville}>📍 {patron?.ville || FR.cityUnknown}</Text>
                <View style={[s.statusBadge, statusStyle]}>
                  <View style={[s.statusDot, { backgroundColor: statusColor }]} />
                  <Text style={[s.statusTxt, { color: statusColor }]}>{statusLabel}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        <Text style={s.secEyebrow}>{FR.subscription}</Text>
        <View style={s.aboCard}>
          <View style={s.aboCardHeader}>
            <View style={[s.aboBadge, hasActive ? s.aboBadgeActive : isPaused ? s.aboBadgePaused : s.aboBadgeInactive]}>
              <View
                style={[
                  s.aboBadgeDot,
                  { backgroundColor: hasActive ? C.green : isPaused ? C.amber : C.terra },
                ]}
              />
              <Text
                style={[
                  s.aboBadgeTxt,
                  { color: hasActive ? C.green : isPaused ? C.amber : C.terra },
                ]}
              >
                {subscriptionLabel}
              </Text>
            </View>
          </View>
          <Text style={s.aboCardTitle}>{FR.subscription}</Text>
          <Text style={s.aboCardDesc}>{subscriptionDescription}</Text>
          <TouchableOpacity style={s.btnPrimary} onPress={() => router.push('/abonnement')} activeOpacity={0.85}>
            <Text style={s.btnPrimaryTxt}>{FR.seeOffers}</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.secEyebrow}>{FR.info}</Text>
        <View style={s.infoCard}>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>{FR.infoPrenom}</Text>
            <Text style={s.infoVal}>{patron?.prenom || '-'}</Text>
          </View>
          <View style={s.infoDivider} />
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>{FR.infoEmail}</Text>
            <Text style={s.infoVal}>{patron?.email || '-'}</Text>
          </View>
          <View style={s.infoDivider} />
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>{FR.infoPhone}</Text>
            <Text style={s.infoVal}>{patron?.telephone || '-'}</Text>
          </View>
        </View>

        <Text style={s.secEyebrow}>{FR.actions}</Text>
        <TouchableOpacity style={s.actionCard} onPress={() => router.push('/modifier-profil-patron')} activeOpacity={0.82}>
          <Text style={s.actionTxt}>{FR.editProfile}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.actionCard} onPress={() => router.push('/mes-etablissements')} activeOpacity={0.82}>
          <Text style={s.actionTxt}>{etablissementCount > 0 ? FR.manageVenues : FR.addVenue}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.logoutBtn} onPress={handleDeconnexion} activeOpacity={0.7}>
          <Text style={s.logoutTxt}>{FR.logout}</Text>
        </TouchableOpacity>
      </ScrollView>

      <PatronBottomNav />
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  loadWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { paddingBottom: 132 },

  header: { paddingTop: 50, paddingHorizontal: 18, paddingBottom: 8 },
  backTxt: { fontSize: 15, color: C.terra, fontWeight: '700', marginBottom: 16 },
  heroCard: {
    backgroundColor: C.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 18,
    shadowColor: '#120E0A',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 2,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarTap: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
  avatarFrame: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: '#FFF8F2',
    borderWidth: 1,
    borderColor: C.terraBd,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#120E0A',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 2,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: C.terraBg,
    borderWidth: 1.5,
    borderColor: C.terraBd,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1.5,
    borderColor: C.terraBd,
    backgroundColor: C.terraBg,
  },
  avatarTxt: { fontSize: 28, fontWeight: '800', color: C.terra },
  avatarOverlay: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.title,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.card,
  },
  avatarOverlayTxt: { fontSize: 12, color: '#FFFFFF', fontWeight: '800' },
  heroInfo: { flex: 1 },
  nom: { fontSize: 27, fontWeight: '800', color: C.title, letterSpacing: -0.6, marginBottom: 4 },
  ville: { fontSize: 13, color: C.textSoft, marginBottom: 10, fontWeight: '600' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusBadgeActive: { backgroundColor: C.greenBg, borderColor: C.greenBd },
  statusBadgePaused: { backgroundColor: C.amberBg, borderColor: C.amberBd },
  statusBadgeInactive: { backgroundColor: C.terraBg, borderColor: C.terraBd },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { fontSize: 12, fontWeight: '700' },

  secEyebrow: {
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: C.textMuted,
    fontWeight: '700',
    marginBottom: 10,
    paddingHorizontal: 18,
    marginTop: 28,
  },

  aboCard: {
    marginHorizontal: 18,
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 1,
  },
  aboCardHeader: { marginBottom: 12 },
  aboBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  aboBadgeActive: { backgroundColor: C.greenBg, borderColor: C.greenBd },
  aboBadgePaused: { backgroundColor: C.amberBg, borderColor: C.amberBd },
  aboBadgeInactive: { backgroundColor: C.terraBg, borderColor: C.terraBd },
  aboBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  aboBadgeTxt: { fontSize: 11, fontWeight: '700' },
  aboCardTitle: { fontSize: 20, fontWeight: '800', color: C.title, marginBottom: 6, letterSpacing: -0.3 },
  aboCardDesc: { fontSize: 13, color: C.textMuted, lineHeight: 19, marginBottom: 16 },

  btnPrimary: { backgroundColor: C.terra, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  btnPrimaryTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },

  infoCard: {
    marginHorizontal: 18,
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 1,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  infoLabel: { fontSize: 13, color: C.textMuted },
  infoVal: { fontSize: 13, fontWeight: '600', color: C.title, flexShrink: 1, textAlign: 'right' },
  infoDivider: { height: 1, backgroundColor: C.borderSoft, marginHorizontal: 16 },

  actionCard: {
    marginHorizontal: 18,
    marginTop: 12,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  actionTxt: { fontSize: 14, color: C.terra, fontWeight: '700' },

  logoutBtn: { alignItems: 'center', paddingVertical: 20, marginTop: 8 },
  logoutTxt: { fontSize: 13, color: C.red, fontWeight: '500' },
})
