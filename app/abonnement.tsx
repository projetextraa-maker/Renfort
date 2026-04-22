import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Pressable, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { getPatronPlanDisplay, getPatronPlanOffer, type PatronBillingCycle } from '../lib/billing'

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
  const cycleAnim = useRef(new Animated.Value(1)).current
  const featuredCardAnim = useRef(new Animated.Value(0.98)).current
  const freeOffer = getPatronPlanOffer('none')
  const proOffer = getPatronPlanDisplay('pro', billingCycle)
  const proPlusOffer = getPatronPlanDisplay('pro_plus', billingCycle)

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
        <Text style={styles.subtitle}>Une offre claire, simple et adaptée à votre rythme.</Text>

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
              ? 'Pour une activité toute l’année'
              : 'Flexible pour un usage ponctuel'}
        </Text>

        {billingCycle === 'monthly' && (
          <View style={styles.card}>
            <Text style={styles.planName}>{freeOffer.title}</Text>
            <Animated.View style={priceAnimatedStyle}>
              <Text style={styles.planPrice}>{freeOffer.priceLabel}</Text>
              <Text style={styles.planHint}>{freeOffer.contextLabel}</Text>
              <Text style={styles.planFeatureCompact}>{freeOffer.commissionLabel}</Text>
            </Animated.View>
            <Pressable
              style={({ pressed }) => [styles.planBtn, styles.planBtnLight, pressed && styles.planBtnPressed]}
              onPress={() => router.replace('/dashboard_patron')}
            >
              <Text style={[styles.planBtnTxt, styles.planBtnLightTxt]}>{freeOffer.ctaLabel}</Text>
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
          </Animated.View>
          <Pressable
            style={({ pressed }) => [
              styles.planBtn,
              styles.planBtnFeatured,
              pressed && styles.planBtnPressed,
            ]}
            onPress={() =>
              router.push({
                pathname: '/abonnement-confirmation',
                params: { plan: 'pro', cycle: billingCycle },
              })
            }
          >
            <Text style={styles.planBtnTxt}>{proOffer.ctaLabel}</Text>
          </Pressable>
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
          </Animated.View>
          <Pressable
            style={({ pressed }) => [
              styles.planBtn,
              styles.planBtnFeatured,
              pressed && styles.planBtnPressed,
            ]}
            onPress={() =>
              router.push({
                pathname: '/abonnement-confirmation',
                params: { plan: 'pro_plus', cycle: billingCycle },
              })
            }
          >
            <Text style={styles.planBtnTxt}>{proPlusOffer.ctaLabel}</Text>
          </Pressable>
        </View>

        <Text style={styles.commitmentText}>
          {billingCycle === 'monthly'
            ? 'Annulable à tout moment'
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

  planBtn: { marginTop: 14, borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  planBtnLight: { backgroundColor: '#F6F1EA', borderWidth: 1, borderColor: C.border },
  planBtnFeatured: { backgroundColor: C.terra, shadowColor: C.terra, shadowOpacity: 0.18, shadowOffset: { width: 0, height: 10 }, shadowRadius: 18, elevation: 5 },
  planBtnTxt: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  planBtnLightTxt: { color: C.text },
  planBtnPressed: { transform: [{ scale: 0.985 }] },

  commitmentText: { fontSize: 13, lineHeight: 19, color: C.muted, textAlign: 'center', marginTop: 4, marginBottom: 8 },
})
