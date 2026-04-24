import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Alert, Animated, Easing, Linking, Pressable, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { getPatronPlanDisplay, getPatronPlanOffer, type PatronBillingCycle } from '../lib/billing'
import { EURO } from '../lib/currency'
import { supabase } from '../lib/supabase'

const C = {
  bg: '#F7F4EE',
  card: '#FFFFFF',
  border: '#E9DFD2',
  title: '#181511',
  text: '#5F574C',
  muted: '#9A8C7E',
  terra: '#C46A3C',
  terraSoft: '#FFF8F2',
  terraBorder: '#E8B08C',
  green: '#2E8B57',
  greenSoft: '#F3F8F3',
  greenBorder: '#B9D4C2',
}

export default function AbonnementScreen() {
  const router = useRouter()
  const [billingCycle, setBillingCycle] = useState<PatronBillingCycle>('semiannual')
  const [currentSubscription, setCurrentSubscription] = useState<string | null>(null)
  const [currentStripeStatus, setCurrentStripeStatus] = useState<string | null>(null)
  const [currentStripePriceId, setCurrentStripePriceId] = useState<string | null>(null)
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false)
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const cycleAnim = useRef(new Animated.Value(1)).current
  const featuredCardAnim = useRef(new Animated.Value(0.98)).current
  const freeOffer = getPatronPlanOffer('none')
  const proOffer = getPatronPlanDisplay('pro', billingCycle)
  const proPlusOffer = getPatronPlanDisplay('pro_plus', billingCycle)
  const launchOfferVisible = true
  const freeOfferDisplay = {
    ...freeOffer,
    priceLabel: `10${EURO} / mission`,
    contextLabel: 'Pour tester ou un besoin ponctuel',
  }

  useEffect(() => {
    cycleAnim.setValue(0)
    Animated.timing(cycleAnim, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [billingCycle, cycleAnim])

  useEffect(() => {
    Animated.spring(featuredCardAnim, {
      toValue: 1,
      friction: 8,
      tension: 120,
      useNativeDriver: true,
    }).start()
  }, [featuredCardAnim])

  useEffect(() => {
    let cancelled = false

    const loadCurrentSubscription = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user || cancelled) return

      const { data: billingProfile } = await supabase
        .from('patron_billing_profiles')
        .select('current_plan, stripe_status, stripe_price_id, cancel_at_period_end, current_period_end')
        .eq('patron_id', user.id)
        .maybeSingle()

      if (!cancelled) {
        setCurrentSubscription(billingProfile?.current_plan ?? null)
        setCurrentStripeStatus(billingProfile?.stripe_status ?? null)
        setCurrentStripePriceId(billingProfile?.stripe_price_id ?? null)
        setCancelAtPeriodEnd(Boolean(billingProfile?.cancel_at_period_end))
        setCurrentPeriodEnd(billingProfile?.current_period_end ?? null)
      }
    }

    void loadCurrentSubscription()

    return () => {
      cancelled = true
    }
  }, [])

  const getDisplayedPriceId = (plan: 'pro' | 'pro_plus', cycle: PatronBillingCycle) => {
    if (plan === 'pro') {
      if (cycle === 'semiannual') return process.env.EXPO_PUBLIC_STRIPE_PRICE_PRO_SEMIANNUAL ?? ''
      if (cycle === 'annual') return process.env.EXPO_PUBLIC_STRIPE_PRICE_PRO_ANNUAL ?? ''
      return process.env.EXPO_PUBLIC_STRIPE_PRICE_PRO_MONTHLY ?? ''
    }

    if (cycle === 'semiannual') return process.env.EXPO_PUBLIC_STRIPE_PRICE_PRO_PLUS_SEMIANNUAL ?? ''
    if (cycle === 'annual') return process.env.EXPO_PUBLIC_STRIPE_PRICE_PRO_PLUS_ANNUAL ?? ''
    return process.env.EXPO_PUBLIC_STRIPE_PRICE_PRO_PLUS_MONTHLY ?? ''
  }

  const displayedProPriceId = getDisplayedPriceId('pro', billingCycle)
  const displayedProPlusPriceId = getDisplayedPriceId('pro_plus', billingCycle)
  const hasActiveStripeSubscription =
    (currentStripeStatus === 'active' || currentStripeStatus === 'trialing') &&
    Boolean(currentStripePriceId)

  const isCurrentNone = !hasActiveStripeSubscription
  const isCurrentPro = hasActiveStripeSubscription && currentStripePriceId === displayedProPriceId
  const isCurrentProPlus = hasActiveStripeSubscription && currentStripePriceId === displayedProPlusPriceId
  const hasManagedSubscription = hasActiveStripeSubscription

  const formatPeriodEnd = (value: string | null) => {
    if (!value) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleDateString('fr-FR')
  }

  const activeUntilLabel = formatPeriodEnd(currentPeriodEnd)
  const currentSubscriptionStatusText = cancelAtPeriodEnd ? 'Resiliation en cours' : null

  const openBillingPortal = async () => {
    if (!hasManagedSubscription || subscriptionLoading) return

    try {
      setSubscriptionLoading(true)
      const { data, error } = await supabase.functions.invoke('stripe-create-portal-session')

      if (error || !data?.url) {
        Alert.alert('Abonnement', 'Impossible d ouvrir la gestion de votre abonnement pour le moment.')
        return
      }

      const canOpen = await Linking.canOpenURL(data.url)
      if (!canOpen) {
        Alert.alert('Abonnement', 'Le lien de gestion est indisponible.')
        return
      }

      await Linking.openURL(data.url)
    } catch (error) {
      console.error('billing portal open error', error)
      Alert.alert('Abonnement', 'Impossible d ouvrir la gestion de votre abonnement pour le moment.')
    } finally {
      setSubscriptionLoading(false)
    }
  }

  const handleCancelSubscription = async () => {
    if (!hasManagedSubscription || cancelAtPeriodEnd || subscriptionLoading) return

    Alert.alert(
      'Resilier mon abonnement',
      "Voulez-vous resilier votre abonnement ?\nIl restera actif jusqu'a la fin de la periode en cours.",
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Resilier',
          style: 'destructive',
          onPress: async () => {
            try {
              setSubscriptionLoading(true)
              const {
                data: { user },
              } = await supabase.auth.getUser()

              if (!user) return

              const { error } = await supabase
                .from('patrons')
                .update({ cancel_at_period_end: true })
                .eq('id', user.id)

              if (error) {
                Alert.alert('Abonnement', error.message || 'Impossible de resilier l abonnement pour le moment.')
                return
              }

              setCancelAtPeriodEnd(true)
            } finally {
              setSubscriptionLoading(false)
            }
          },
        },
      ]
    )
  }

  const priceAnimatedStyle = {
    opacity: cycleAnim,
    transform: [
      {
        translateY: cycleAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [6, 0],
        }),
      },
    ],
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Text style={styles.backTxt}>Retour</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Choisissez votre formule</Text>
        {launchOfferVisible ? (
          <View style={styles.launchOfferCard}>
            <Text style={styles.launchOfferTitle}>Offre de lancement</Text>
            <Text style={styles.launchOfferText}>Frais plateforme offerts sur votre premiere mission</Text>
            <Text style={styles.launchOfferSub}>Valable une seule fois pour les 30 premiers patrons, apres mission realisee.</Text>
          </View>
        ) : null}
        <Text style={styles.subtitle}>Une offre claire, simple et adaptee a votre rythme.</Text>

        <View style={styles.cycleToggle}>
          <Pressable
            style={[styles.cycleChip, billingCycle === 'monthly' && styles.cycleChipActive]}
            onPress={() => setBillingCycle('monthly')}
            android_ripple={{ color: '#EDE4D8' }}
          >
            {({ pressed }) => (
              <Animated.View style={[styles.cycleChipInner, pressed && styles.cycleChipPressed]}>
                <Text style={[styles.cycleChipTxt, billingCycle === 'monthly' && styles.cycleChipTxtActive]}>Mensuel</Text>
              </Animated.View>
            )}
          </Pressable>
          <Pressable
            style={[styles.cycleChip, billingCycle === 'semiannual' && styles.cycleChipActive]}
            onPress={() => setBillingCycle('semiannual')}
            android_ripple={{ color: '#F3DED0' }}
          >
            {({ pressed }) => (
              <Animated.View style={[styles.cycleChipInner, pressed && styles.cycleChipPressed]}>
                <Text style={[styles.cycleChipTxt, billingCycle === 'semiannual' && styles.cycleChipTxtActive]}>6 mois</Text>
              </Animated.View>
            )}
          </Pressable>
          <Pressable
            style={[styles.cycleChip, billingCycle === 'annual' && styles.cycleChipActive]}
            onPress={() => setBillingCycle('annual')}
            android_ripple={{ color: '#EDE4D8' }}
          >
            {({ pressed }) => (
              <Animated.View style={[styles.cycleChipInner, pressed && styles.cycleChipPressed]}>
                <Text style={[styles.cycleChipTxt, billingCycle === 'annual' && styles.cycleChipTxtActive]}>Annuel</Text>
              </Animated.View>
            )}
          </Pressable>
        </View>

        <Text style={styles.cycleHint}>
          {billingCycle === 'semiannual'
            ? 'Parfait pour la saison estivale'
            : billingCycle === 'annual'
              ? "Pour une activite toute l'annee"
              : 'Flexible pour un usage ponctuel'}
        </Text>

        {billingCycle === 'monthly' && (
          <View style={styles.card}>
            {launchOfferVisible ? (
              <View style={styles.subtleBadge}>
                <Text style={styles.subtleBadgeTxt}>Frais offerts sur le 1er extra</Text>
              </View>
            ) : null}
            <Text style={styles.planName}>{freeOfferDisplay.title}</Text>
            <Animated.View style={priceAnimatedStyle}>
              <Text style={styles.planPrice}>{freeOfferDisplay.priceLabel}</Text>
              <Text style={styles.planHint}>{freeOfferDisplay.contextLabel}</Text>
              <Text style={styles.planFeatureCompact}>{freeOfferDisplay.commissionLabel}</Text>
            </Animated.View>
            <Pressable
              style={({ pressed }) => [
                styles.planBtn,
                styles.planBtnLight,
                isCurrentNone && styles.planBtnDisabled,
                pressed && !isCurrentNone && styles.planBtnPressed,
              ]}
              onPress={() => {
                if (isCurrentNone) return
                router.replace('/dashboard_patron')
              }}
              disabled={isCurrentNone}
            >
              <Text style={[styles.planBtnTxt, styles.planBtnLightTxt, isCurrentNone && styles.planBtnDisabledTxt]}>
                {isCurrentNone ? '✔ Offre actuelle' : 'Choisir'}
              </Text>
            </Pressable>
          </View>
        )}

        <Animated.View
          style={[
            styles.card,
            styles.cardFeatured,
            {
              transform: [{ scale: featuredCardAnim }],
            },
          ]}
        >
          {(proOffer.badgeLabel || proOffer.contextLabel) && (
            <View style={styles.badge}>
              <Text style={styles.badgeTxt}>{proOffer.badgeLabel ?? proOffer.contextLabel}</Text>
            </View>
          )}
          <Text style={styles.planName}>{proOffer.title}</Text>
          <Animated.View style={priceAnimatedStyle}>
            <Text style={styles.planPrice}>{proOffer.priceLabel}</Text>
            <Text style={styles.planHint}>{proOffer.contextLabel}</Text>
            <Text style={styles.planFeatureCompact}>{proOffer.commissionLabel}</Text>
            <Text style={styles.planConversionHint}>Rentable des 7 extras / mois par rapport a l'offre sans abonnement.</Text>
            <Text style={styles.planSocialProof}>- Trouvez du personnel rapidement</Text>
            <Text style={styles.planSocialProof}>- Gagnez du temps sur vos recrutements</Text>
            <Text style={styles.planSocialProof}>Le choix le plus utilise par les etablissements</Text>
          </Animated.View>
          <Pressable
            style={({ pressed }) => [
              styles.planBtn,
              styles.planBtnFeatured,
              isCurrentPro && styles.planBtnDisabledFeatured,
              pressed && !isCurrentPro && styles.planBtnPressed,
            ]}
            onPress={() => {
              if (isCurrentPro) return
              if (hasManagedSubscription) {
                void openBillingPortal()
                return
              }
              router.push({
                pathname: '/abonnement-confirmation',
                params: { plan: 'pro', cycle: billingCycle },
              })
            }}
            disabled={isCurrentPro || subscriptionLoading}
          >
            <Text style={[styles.planBtnTxt, isCurrentPro && styles.planBtnDisabledTxtOnDark]}>
              {isCurrentPro ? '✔ Offre actuelle' : hasManagedSubscription ? 'Changer vers Pro' : 'Choisir'}
            </Text>
          </Pressable>
          {isCurrentPro ? (
            <>
              {currentSubscriptionStatusText ? (
                <Text style={styles.currentOfferMeta}>{currentSubscriptionStatusText}</Text>
              ) : null}
              {cancelAtPeriodEnd ? (
                activeUntilLabel ? <Text style={styles.currentOfferSubMeta}>{`Actif jusqu'au ${activeUntilLabel}`}</Text> : null
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    styles.secondaryActionBtn,
                    pressed && styles.planBtnPressed,
                    subscriptionLoading && styles.secondaryActionBtnDisabled,
                  ]}
                  onPress={() => void handleCancelSubscription()}
                  disabled={subscriptionLoading}
                >
                  <Text style={styles.secondaryActionBtnTxt}>Resilier mon abonnement</Text>
                </Pressable>
              )}
            </>
          ) : null}
        </Animated.View>

        <View style={[styles.card, styles.cardProPlus]}>
          {(proPlusOffer.badgeLabel || proPlusOffer.contextLabel) && (
            <View style={styles.subtleBadge}>
              <Text style={styles.subtleBadgeTxt}>{proPlusOffer.badgeLabel ?? proPlusOffer.contextLabel}</Text>
            </View>
          )}
          <Text style={styles.planName}>{proPlusOffer.title}</Text>
          <Animated.View style={priceAnimatedStyle}>
            <Text style={[styles.planPrice, styles.planPriceProPlus]}>{proPlusOffer.priceLabel}</Text>
            <Text style={styles.planHint}>{proPlusOffer.contextLabel}</Text>
            <Text style={styles.planFeatureCompact}>{proPlusOffer.commissionLabel}</Text>
            <Text style={styles.planConversionHint}>Rentable des 10-12 extras / mois par rapport a l'offre sans abonnement.</Text>
            <Text style={styles.planSocialProof}>- Reduisez vos couts sur vos missions</Text>
            <Text style={styles.planSocialProof}>- Ideal pour les etablissements reguliers</Text>
          </Animated.View>
          <Pressable
            style={({ pressed }) => [
              styles.planBtn,
              styles.planBtnFeatured,
              isCurrentProPlus && styles.planBtnDisabledFeatured,
              pressed && !isCurrentProPlus && styles.planBtnPressed,
            ]}
            onPress={() => {
              if (isCurrentProPlus) return
              if (hasManagedSubscription) {
                void openBillingPortal()
                return
              }
              router.push({
                pathname: '/abonnement-confirmation',
                params: { plan: 'pro_plus', cycle: billingCycle },
              })
            }}
            disabled={isCurrentProPlus || subscriptionLoading}
          >
            <Text style={[styles.planBtnTxt, isCurrentProPlus && styles.planBtnDisabledTxtOnDark]}>
              {isCurrentProPlus ? '✔ Offre actuelle' : hasManagedSubscription ? 'Changer vers Pro+' : 'Choisir'}
            </Text>
          </Pressable>
          {isCurrentProPlus ? (
            <>
              {currentSubscriptionStatusText ? (
                <Text style={styles.currentOfferMeta}>{currentSubscriptionStatusText}</Text>
              ) : null}
              {cancelAtPeriodEnd ? (
                activeUntilLabel ? <Text style={styles.currentOfferSubMeta}>{`Actif jusqu'au ${activeUntilLabel}`}</Text> : null
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    styles.secondaryActionBtn,
                    pressed && styles.planBtnPressed,
                    subscriptionLoading && styles.secondaryActionBtnDisabled,
                  ]}
                  onPress={() => void handleCancelSubscription()}
                  disabled={subscriptionLoading}
                >
                  <Text style={styles.secondaryActionBtnTxt}>Resilier mon abonnement</Text>
                </Pressable>
              )}
            </>
          ) : null}
        </View>

        <Text style={styles.commitmentText}>
          {billingCycle === 'monthly'
            ? 'Annulable a tout moment'
            : 'Aucun engagement sur le renouvellement'}
        </Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 40 },
  backBtn: { alignSelf: 'flex-start', marginBottom: 22 },
  backTxt: { color: C.terra, fontSize: 15, fontWeight: '700' },
  title: { fontSize: 32, lineHeight: 36, fontWeight: '800', color: C.title, letterSpacing: -0.9, marginBottom: 10 },
  launchOfferCard: { backgroundColor: C.greenSoft, borderWidth: 1, borderColor: C.greenBorder, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 14 },
  launchOfferTitle: { fontSize: 14, fontWeight: '800', color: C.green, marginBottom: 4 },
  launchOfferText: { fontSize: 14, lineHeight: 20, color: C.title, fontWeight: '700' },
  launchOfferSub: { fontSize: 12, lineHeight: 18, color: C.text, marginTop: 4 },
  subtitle: { fontSize: 15, lineHeight: 21, color: C.text, marginBottom: 22 },
  cycleToggle: { flexDirection: 'row', gap: 8, backgroundColor: '#F2ECE3', borderRadius: 16, padding: 4, marginBottom: 16 },
  cycleChip: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F4EE', borderWidth: 1, borderColor: '#EAEAEA' },
  cycleChipInner: { alignItems: 'center', justifyContent: 'center' },
  cycleChipActive: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, shadowColor: '#181511', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10, elevation: 1 },
  cycleChipPressed: { transform: [{ scale: 0.98 }] },
  cycleChipTxt: { fontSize: 13, fontWeight: '700', color: C.muted },
  cycleChipTxtActive: { color: C.title },
  cycleHint: { fontSize: 13, color: C.text, fontWeight: '600', marginBottom: 16, textAlign: 'center' },

  card: { backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.border, padding: 20, marginBottom: 16 },
  cardFeatured: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, shadowColor: C.terra, shadowOpacity: 0.14, shadowOffset: { width: 0, height: 12 }, shadowRadius: 24, elevation: 7 },
  cardProPlus: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, shadowColor: '#181511', shadowOpacity: 0.08, shadowOffset: { width: 0, height: 8 }, shadowRadius: 18, elevation: 3 },
  badge: { alignSelf: 'flex-start', backgroundColor: '#FCE2D2', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 12 },
  badgeTxt: { color: C.terra, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  subtleBadge: { alignSelf: 'flex-start', backgroundColor: '#F8EFE6', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 12, borderWidth: 1, borderColor: '#E8D5C2' },
  subtleBadgeTxt: { color: '#8F5E3D', fontSize: 12, fontWeight: '700' },

  planName: { fontSize: 22, fontWeight: '800', color: C.title, marginBottom: 6 },
  planPrice: { fontSize: 24, fontWeight: '800', color: C.terra, marginBottom: 10, letterSpacing: -0.5 },
  planPriceProPlus: { color: C.title },
  planHint: { fontSize: 13, lineHeight: 18, color: C.text, marginBottom: 6, fontWeight: '600' },
  planFeature: { fontSize: 14, lineHeight: 20, color: C.text, marginTop: 2 },
  planFeatureCompact: { fontSize: 14, lineHeight: 20, color: C.text, marginTop: 2 },
  planConversionHint: { fontSize: 13, lineHeight: 18, color: C.green, fontWeight: '800', marginTop: 10 },
  planSocialProof: { fontSize: 13, lineHeight: 18, color: C.text, fontWeight: '600', marginTop: 4 },

  planBtn: { marginTop: 14, borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  planBtnLight: { backgroundColor: '#F6F1EA', borderWidth: 1, borderColor: C.border },
  planBtnFeatured: { backgroundColor: C.terra, shadowColor: C.terra, shadowOpacity: 0.18, shadowOffset: { width: 0, height: 10 }, shadowRadius: 18, elevation: 5 },
  planBtnTxt: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  planBtnLightTxt: { color: C.text },
  planBtnDisabled: { backgroundColor: '#EFE7DC', borderColor: '#E4D8C9' },
  planBtnDisabledFeatured: { backgroundColor: '#E6D7CC', shadowOpacity: 0, elevation: 0 },
  planBtnDisabledTxt: { color: C.muted },
  planBtnDisabledTxtOnDark: { color: '#6B6156' },
  planBtnPressed: { transform: [{ scale: 0.985 }] },
  currentOfferMeta: { fontSize: 13, lineHeight: 18, color: C.text, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  currentOfferSubMeta: { fontSize: 13, lineHeight: 18, color: C.muted, fontWeight: '600', marginTop: 4, textAlign: 'center' },
  secondaryActionBtn: {
    marginTop: 10,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2ECE3',
    borderWidth: 1,
    borderColor: C.border,
  },
  secondaryActionBtnDisabled: { opacity: 0.7 },
  secondaryActionBtnTxt: { color: C.title, fontSize: 15, fontWeight: '800' },

  commitmentText: { fontSize: 13, lineHeight: 19, color: C.muted, textAlign: 'center', marginTop: 4, marginBottom: 8 },
})
