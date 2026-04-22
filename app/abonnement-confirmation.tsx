import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert, Linking, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native'
import { getPatronPlanDisplay, normalizePatronBillingCycle, normalizePatronPlan } from '../lib/billing'
import { supabase } from '../lib/supabase'

const C = {
  bg: '#F7F4EE',
  card: '#FFFFFF',
  border: '#E9DFD2',
  title: '#181511',
  text: '#5F574C',
  muted: '#9A8C7E',
  terra: '#C46A3C',
}

export default function AbonnementConfirmationScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ plan?: string; cycle?: string }>()
  const [loading, setLoading] = useState(false)

  const plan = normalizePatronPlan(params.plan)
  const cycle = normalizePatronBillingCycle(params.cycle)
  const offer = getPatronPlanDisplay(plan, cycle)

  const continueToPayment = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase.functions.invoke('stripe-create-checkout-session', {
        body: { plan, cycle },
      })

      if (error || !data?.url) {
        Alert.alert('Erreur', 'Impossible d’ouvrir le paiement pour le moment.')
        return
      }

      const canOpen = await Linking.canOpenURL(data.url)
      if (!canOpen) {
        Alert.alert('Erreur', 'Le lien de paiement est indisponible.')
        return
      }

      await Linking.openURL(data.url)
    } catch (e) {
      console.error('abonnement-confirmation checkout error', e)
      Alert.alert('Erreur', 'Impossible de continuer vers le paiement.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backTxt}>Retour</Text>
        </Pressable>

        <Text style={styles.title}>Confirmez votre formule</Text>
        <Text style={styles.subtitle}>Un dernier récapitulatif avant le paiement.</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Offre</Text>
          <Text style={styles.value}>{offer.title}</Text>

          <View style={styles.divider} />

          <Text style={styles.label}>Tarif</Text>
          <Text style={styles.value}>{offer.priceLabel}</Text>

          <View style={styles.divider} />

          <Text style={styles.label}>Commission</Text>
          <Text style={styles.value}>{offer.commissionLabel}</Text>

          <View style={styles.divider} />

          <Text style={styles.info}>Sans engagement</Text>
          <Text style={styles.info}>Annulable à tout moment</Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed, loading && styles.primaryBtnDisabled]}
          onPress={continueToPayment}
          disabled={loading}
        >
          <Text style={styles.primaryBtnTxt}>
            {loading ? 'Ouverture du paiement...' : 'Continuer vers le paiement'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 40 },
  backBtn: { alignSelf: 'flex-start', marginBottom: 20 },
  backTxt: { color: C.terra, fontSize: 15, fontWeight: '700' },
  title: { fontSize: 32, lineHeight: 36, fontWeight: '800', color: C.title, letterSpacing: -0.8, marginBottom: 10 },
  subtitle: { fontSize: 15, lineHeight: 21, color: C.text, marginBottom: 22 },
  card: { backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.border, padding: 20, marginBottom: 20 },
  label: { fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700', marginBottom: 6 },
  value: { fontSize: 20, color: C.title, fontWeight: '800' },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 16 },
  info: { fontSize: 14, lineHeight: 20, color: C.text, fontWeight: '600' },
  primaryBtn: { backgroundColor: C.terra, borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  primaryBtnPressed: { transform: [{ scale: 0.985 }] },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnTxt: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
})
