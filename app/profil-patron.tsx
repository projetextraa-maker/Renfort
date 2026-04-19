import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { fetchEtablissementsForPatron, getDefaultEtablissement } from '../lib/etablissements'
import {
  getEstimatedOverageAmount,
  getIncludedMissionsForPlan,
  getOverageCount,
  getRemainingMissions,
  isActiveSubscription,
  syncPatronSubscriptionCycle,
} from '../lib/subscription'
import PatronBottomNav from '../components/PatronBottomNav'
import { EURO } from '../lib/currency'
import { supabase } from '../lib/supabase'

const C = {
  bg:         '#F7F4EE',
  card:       '#FFFFFF',
  cardSoft:   '#F4EFE7',
  border:     '#E6DED2',
  borderSoft: '#EFE7DB',
  title:      '#171614',
  text:       '#2A2723',
  textSoft:   '#6D675E',
  textMuted:  '#9A9388',
  terra:      '#C46A3C',
  terraBg:    '#FEF3EB',
  terraBd:    '#F5C9A9',
  green:      '#2E8B57',
  greenBg:    '#F0F8F3',
  greenBd:    '#C0DEC8',
  amber:      '#B8893C',
  amberBg:    '#FBF5E8',
  amberBd:    '#E8D4A0',
  red:        '#C84B4B',
  redBg:      '#FEF2F2',
  redBd:      '#F2CACA',
}

export default function ProfilPatron() {
  const router = useRouter()
  const [patron,             setPatron]             = useState<any>(null)
  const [etablissementCount, setEtablissementCount] = useState(0)
  const [defaultEtablissement, setDefaultEtablissementState] = useState<any>(null)
  const [loading,            setLoading]            = useState(true)
  const [resiliationLoading, setResiliationLoading] = useState(false)
  const [pauseLoading,       setPauseLoading]       = useState(false)

  useEffect(() => { chargerProfil() }, [])

  const chargerProfil = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
      .from('patrons').select('*').eq('id', user.id).single()

    if (!error && data) {
      await syncPatronSubscriptionCycle(user.id)
      const { data: fresh } = await supabase
        .from('patrons').select('*').eq('id', user.id).single()
      setPatron(fresh ?? data)
      const etablissements = await fetchEtablissementsForPatron(user.id)
      setEtablissementCount(etablissements.length)
      setDefaultEtablissementState(getDefaultEtablissement(etablissements))
    }
    setLoading(false)
  }

  const handleDeconnexion = async () => {
    Alert.alert('Se déconnecter', 'Voulez-vous vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Se déconnecter',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut()
          router.push('/')
        }
      }
    ])
  }

  const resilierAbonnement = async () => {
    try {
      setResiliationLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      await supabase.from('patrons').update({
        abonnement: null, missions_incluses: 0,
        missions_utilisees_ce_mois: 0, missions_hors_forfait_ce_mois: 0,
      }).eq('id', user.id)

      setPatron((c: any) => c ? { ...c, abonnement: null } : c)
      Alert.alert('Abonnement résilié', 'Votre abonnement a été résilié.', [
        { text: 'OK', onPress: () => router.replace('/dashboard_patron') }
      ])
    } catch {
      Alert.alert('Erreur', "Impossible de résilier l'abonnement")
    } finally {
      setResiliationLoading(false)
    }
  }

  const mettreEnPause = async () => {
    const pause = patron?.abonnement === 'pro_plus' ? 'pro_plus_pause' :
                  patron?.abonnement === 'pro' ? 'pro_pause' : null
    if (!pause) return
    try {
      setPauseLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('patrons').update({ abonnement: pause }).eq('id', user.id)
      setPatron((c: any) => c ? { ...c, abonnement: pause } : c)
      Alert.alert('Abonnement en pause', 'Votre abonnement a été suspendu.')
    } catch {
      Alert.alert('Erreur', "Impossible de mettre en pause")
    } finally {
      setPauseLoading(false)
    }
  }

  const reactiverAbonnement = async () => {
    const actif = patron?.abonnement === 'pro_plus_pause' ? 'pro_plus' :
                  patron?.abonnement === 'pro_pause' ? 'pro' : null
    if (!actif) return
    try {
      setPauseLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('patrons').update({ abonnement: actif }).eq('id', user.id)
      setPatron((c: any) => c ? { ...c, abonnement: actif } : c)
      Alert.alert('Abonnement réactivé', 'Votre abonnement est de nouveau actif.')
    } catch {
      Alert.alert('Erreur', "Impossible de rÃ©activer")
    } finally {
      setPauseLoading(false)
    }
  }

  const confirmerResiliation = () => {
    Alert.alert("Résilier l'abonnement", 'Cette action est irréversible. Voulez-vous continuer ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Résilier', style: 'destructive', onPress: resilierAbonnement },
    ])
  }

  const confirmerPause = () => {
    Alert.alert('Mettre en pause ?', 'Vos missions seront suspendues. Vous pourrez réactiver à tout moment.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Mettre en pause', onPress: mettreEnPause },
    ])
  }

  if (loading) {
    return (
      <View style={s.loadWrap}>
        <Text style={{ color: C.textMuted }}>Chargement...</Text>
      </View>
    )
  }

  const abo                   = patron?.abonnement
  const hasActive             = isActiveSubscription(abo)
  const isPaused              = abo === 'pro_pause' || abo === 'pro_plus_pause'
  const includedMissions      = patron?.missions_incluses ?? getIncludedMissionsForPlan(abo)
  const usedMissions          = patron?.missions_utilisees_ce_mois ?? 0
  const remainingMissions     = getRemainingMissions(patron)
  const overageCount          = getOverageCount(patron)
  const overageAmount         = getEstimatedOverageAmount(patron)

  const nomResto    = defaultEtablissement?.nom ?? patron?.nom_restaurant ?? ''
  const initiales   = nomResto?.[0]?.toUpperCase() ?? patron?.prenom?.[0]?.toUpperCase() ?? '?'
  const principalLabel = defaultEtablissement?.nom ?? patron?.nom_restaurant ?? 'Aucun'

  const aboLabel = () => {
    switch (abo) {
      case 'pro':            return `Pro · 49${EURO}/mois`
      case 'pro_plus':       return `Pro+ · 89${EURO}/mois`
      case 'pro_pause':
      case 'pro_plus_pause': return 'En pause'
      default:               return `À l'acte · 10${EURO}/mission`
    }
  }

  const aboColor = () => {
    if (hasActive)  return C.green
    if (isPaused)   return C.amber
    return C.textMuted
  }

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* â”€â”€ HEADER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.backTxt}>â† Retour</Text>
          </TouchableOpacity>

          <View style={s.heroRow}>
            <View style={s.avatar}>
              <Text style={s.avatarTxt}>{initiales}</Text>
            </View>
            <View style={s.heroInfo}>
              <Text style={s.nom}>{nomResto || patron?.prenom || 'Mon restaurant'}</Text>
              <Text style={s.ville}>📍 {patron?.ville}</Text>

              {/* Statut */}
              <View style={s.statusRow}>
                <View style={[s.statusDot, { backgroundColor: aboColor() }]} />
                <Text style={[s.statusTxt, { color: aboColor() }]}>
                  {isPaused ? 'Abonnement en pause' : hasActive ? 'Actif' : 'Sans abonnement'}
                </Text>
              </View>
            </View>
          </View>

          {/* Stats rapides */}
          {(hasActive || isPaused) && (
            <View style={s.quickStats}>
              <View style={s.quickStat}>
                <Text style={s.quickStatVal}>{usedMissions}</Text>
                <Text style={s.quickStatLbl}>utilisées ce mois</Text>
              </View>
              <View style={s.quickStatDiv} />
              <View style={s.quickStat}>
                <Text style={[s.quickStatVal, { color: hasActive ? C.terra : C.textMuted }]}>
                  {hasActive ? remainingMissions : '—'}
                </Text>
                <Text style={s.quickStatLbl}>restantes</Text>
              </View>
              <View style={s.quickStatDiv} />
              <View style={s.quickStat}>
                <Text style={s.quickStatVal}>{includedMissions}</Text>
                <Text style={s.quickStatLbl}>incluses/mois</Text>
              </View>
            </View>
          )}
        </View>

        {/* â”€â”€ BLOC ABONNEMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <Text style={s.secEyebrow}>ABONNEMENT</Text>

        {/* Abonnement en pause */}
        {isPaused && (
          <View style={[s.aboCard, { borderColor: C.amberBd }]}>
            <View style={s.aboCardHeader}>
              <View style={[s.aboBadge, { backgroundColor: C.amberBg, borderColor: C.amberBd }]}>
                <View style={[s.aboBadgeDot, { backgroundColor: C.amber }]} />
                <Text style={[s.aboBadgeTxt, { color: C.amber }]}>En pause</Text>
              </View>
            </View>
            <Text style={s.aboCardTitle}>Abonnement en pause</Text>
            <Text style={s.aboCardDesc}>
              Vos missions sont suspendues. Réactivez pour continuer à recevoir des candidats.
            </Text>
            <TouchableOpacity
              style={[s.btnPrimary, { backgroundColor: C.green }, pauseLoading && s.btnDisabled]}
              onPress={reactiverAbonnement}
              disabled={pauseLoading}
              activeOpacity={0.85}
            >
              <Text style={s.btnPrimaryTxt}>
                {pauseLoading ? 'Réactivation...' : 'Réactiver mon abonnement'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btnLink} onPress={() => router.push('/abonnement')} activeOpacity={0.7}>
              <Text style={s.btnLinkTxt}>Changer de formule</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.btnDanger}
              onPress={confirmerResiliation}
              disabled={resiliationLoading}
              activeOpacity={0.7}
            >
              <Text style={s.btnDangerTxt}>
                {resiliationLoading ? 'Résiliation...' : 'Résilier mon abonnement'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Abonnement actif */}
        {hasActive && (
          <View style={s.aboCard}>
            <View style={s.aboCardHeader}>
              <View style={[s.aboBadge, { backgroundColor: C.greenBg, borderColor: C.greenBd }]}>
                <View style={[s.aboBadgeDot, { backgroundColor: C.green }]} />
                <Text style={[s.aboBadgeTxt, { color: C.green }]}>{aboLabel()}</Text>
              </View>
            </View>
            <Text style={s.aboCardTitle}>
              {abo === 'pro' ? 'Offre Pro' : 'Offre Pro+'}
            </Text>
            <Text style={s.aboCardDesc}>
              {abo === 'pro'
                ? `10 missions réalisées incluses par mois · +5${EURO} par mission supplémentaire`
                : `25 missions réalisées incluses par mois · +4${EURO} par mission supplémentaire`}
            </Text>

            {overageCount > 0 && (
              <View style={s.overageRow}>
                <Text style={s.overageTxt}>
                  {`${overageCount} mission${overageCount > 1 ? 's' : ''} hors forfait Â· ${overageAmount}${EURO} estimés`}
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[s.btnPrimary, pauseLoading && s.btnDisabled]}
              onPress={() => router.push('/abonnement')}
              activeOpacity={0.85}
            >
              <Text style={s.btnPrimaryTxt}>Gérer mon abonnement</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.btnLink}
              onPress={confirmerPause}
              disabled={pauseLoading}
              activeOpacity={0.7}
            >
              <Text style={s.btnLinkTxt}>
                {pauseLoading ? 'Mise en pause...' : 'Mettre en pause'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.btnDanger}
              onPress={confirmerResiliation}
              disabled={resiliationLoading}
              activeOpacity={0.7}
            >
              <Text style={s.btnDangerTxt}>
                {resiliationLoading ? 'Résiliation...' : 'Résilier mon abonnement'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Sans abonnement */}
        {!hasActive && !isPaused && (
          <View style={[s.aboCard, { borderColor: C.terraBd }]}>
            <Text style={s.aboCardTitle}>Sans abonnement</Text>
            <Text style={s.aboCardDesc}>
              {`Vous êtes facturé 10${EURO} par mission réalisée. Aucun frais en cas de refus ou annulation.`}
            </Text>
            <TouchableOpacity
              style={s.btnPrimary}
              onPress={() => router.push('/abonnement')}
              activeOpacity={0.85}
            >
              <Text style={s.btnPrimaryTxt}>Découvrir les abonnements</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* â”€â”€ UPSELL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {!hasActive && !isPaused && (
          <>
            <Text style={[s.secEyebrow, { marginTop: 20 }]}>POURQUOI S&apos;ABONNER ?</Text>
            <View style={s.upsellCard}>
              <Text style={s.upsellTitle}>Abonnements Pro et Pro+</Text>
              <Text style={s.upsellDesc}>
                Gagnez en visibilité et trouvez plus rapidement du personnel qualifié.
              </Text>
              <View style={s.upsellBenefits}>
                {[
                  'Plus de profils disponibles autour de vous',
                  `Missions à partir de 4${EURO} au lieu de 10${EURO}`,
                  'Jusqu\'Ã  25 missions incluses par mois',
                ].map((b, i) => (
                  <View key={i} style={s.benefitRow}>
                    <View style={s.benefitDot} />
                    <Text style={s.benefitTxt}>{b}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity
                style={[s.btnPrimary, { backgroundColor: C.terra }]}
                onPress={() => router.push('/abonnement')}
                activeOpacity={0.85}
              >
                <Text style={s.btnPrimaryTxt}>Voir les offres</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* â”€â”€ INFOS COMPTE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <Text style={[s.secEyebrow, { marginTop: 20 }]}>INFORMATIONS</Text>
        <View style={s.infoCard}>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Prénom</Text>
            <Text style={s.infoVal}>{patron?.prenom}</Text>
          </View>
          <View style={s.infoDivider} />
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Email</Text>
            <Text style={s.infoVal}>{patron?.email}</Text>
          </View>
          <View style={s.infoDivider} />
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Téléphone</Text>
            <Text style={s.infoVal}>{patron?.telephone}</Text>
          </View>
          <View style={s.infoDivider} />
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Ville</Text>
            <Text style={s.infoVal}>{patron?.ville}</Text>
          </View>
          <View style={s.infoDivider} />
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Etablissement principal</Text>
            <Text style={s.infoVal}>{principalLabel}</Text>
          </View>
        </View>

        <TouchableOpacity style={s.editProfileBtn} onPress={() => router.push('/modifier-profil-patron')} activeOpacity={0.8}>
          <Text style={s.editProfileBtnTxt}>Modifier mon profil</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.editProfileBtn} onPress={() => router.push('/mes-etablissements')} activeOpacity={0.8}>
          <Text style={s.editProfileBtnTxt}>
            {etablissementCount > 0 ? `Gerer mes etablissements (${etablissementCount})` : 'Ajouter un etablissement'}
          </Text>
        </TouchableOpacity>

        {/* â”€â”€ DÃ‰CONNEXION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <TouchableOpacity style={s.logoutBtn} onPress={handleDeconnexion} activeOpacity={0.7}>
          <Text style={s.logoutTxt}>Se déconnecter</Text>
        </TouchableOpacity>

      </ScrollView>
      <PatronBottomNav />
    </View>
  )
}

const s = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: C.bg },
  loadWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },
  scroll:   { flex: 1 },
  content:  { paddingBottom: 124 },

  // HEADER
  header:    { paddingTop: 56, paddingHorizontal: 22, paddingBottom: 24, borderBottomWidth: 1, borderBottomColor: C.border },
  backTxt:   { fontSize: 15, color: C.terra, fontWeight: '600', marginBottom: 22 },
  heroRow:   { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  avatar:    { width: 64, height: 64, borderRadius: 18, backgroundColor: C.terraBg, borderWidth: 1.5, borderColor: C.terraBd, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 24, fontWeight: '800', color: C.terra },
  heroInfo:  { flex: 1 },
  nom:       { fontSize: 20, fontWeight: '800', color: C.title, letterSpacing: -0.3, marginBottom: 3 },
  ville:     { fontSize: 12, color: C.textMuted, marginBottom: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { fontSize: 12, fontWeight: '700' },

  // QUICK STATS
  quickStats:    { flexDirection: 'row', backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14 },
  quickStat:     { flex: 1, alignItems: 'center' },
  quickStatVal:  { fontSize: 20, fontWeight: '800', color: C.title, letterSpacing: -0.5 },
  quickStatLbl:  { fontSize: 11, color: C.textMuted, marginTop: 3, textAlign: 'center' },
  quickStatDiv:  { width: 1, backgroundColor: C.border, marginVertical: 4 },

  // SECTION
  secEyebrow: { fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: C.textMuted, fontWeight: '500', marginBottom: 10, paddingHorizontal: 22, marginTop: 24 },

  // ABO CARD
  aboCard:       { marginHorizontal: 16, backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 20, shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 1 },
  aboCardHeader: { marginBottom: 12 },
  aboBadge:      { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  aboBadgeDot:   { width: 6, height: 6, borderRadius: 3 },
  aboBadgeTxt:   { fontSize: 11, fontWeight: '700' },
  aboCardTitle:  { fontSize: 20, fontWeight: '800', color: C.title, marginBottom: 6, letterSpacing: -0.3 },
  aboCardDesc:   { fontSize: 13, color: C.textMuted, lineHeight: 19, marginBottom: 16 },

  overageRow: { backgroundColor: C.amberBg, borderWidth: 1, borderColor: C.amberBd, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16 },
  overageTxt: { fontSize: 12, color: C.amber, fontWeight: '600' },

  // BUTTONS
  btnPrimary:    { backgroundColor: C.terra, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  btnPrimaryTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },
  btnDisabled:   { opacity: 0.6 },

  btnLink:    { paddingVertical: 10, alignItems: 'center', marginBottom: 4 },
  btnLinkTxt: { fontSize: 13, color: C.terra, fontWeight: '600' },

  btnDanger:    { paddingVertical: 10, alignItems: 'center' },
  btnDangerTxt: { fontSize: 12, color: C.red, fontWeight: '500' },

  // UPSELL
  upsellCard:     { marginHorizontal: 16, backgroundColor: C.terraBg, borderRadius: 20, borderWidth: 1, borderColor: C.terraBd, padding: 20 },
  upsellTitle:    { fontSize: 17, fontWeight: '800', color: C.title, marginBottom: 6, letterSpacing: -0.2 },
  upsellDesc:     { fontSize: 13, color: C.textSoft, marginBottom: 14, lineHeight: 18 },
  upsellBenefits: { marginBottom: 16 },
  benefitRow:     { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  benefitDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: C.terra, marginRight: 10, marginTop: 5 },
  benefitTxt:     { fontSize: 13, color: C.textSoft, flex: 1, lineHeight: 18 },

  // INFOS
  infoCard:    { marginHorizontal: 16, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.border, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 1 }, shadowRadius: 4, elevation: 1 },
  infoRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 },
  infoLabel:   { fontSize: 13, color: C.textMuted },
  infoVal:     { fontSize: 13, fontWeight: '600', color: C.title },
  infoDivider: { height: 1, backgroundColor: C.borderSoft, marginHorizontal: 16 },
  editProfileBtn: { marginHorizontal: 16, marginTop: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  editProfileBtnTxt: { fontSize: 14, color: C.terra, fontWeight: '700' },

  // LOGOUT
  logoutBtn: { alignItems: 'center', paddingVertical: 20, marginTop: 8 },
  logoutTxt: { fontSize: 13, color: C.red, fontWeight: '500' },
})
