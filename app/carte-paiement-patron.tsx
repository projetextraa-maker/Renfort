import { CardField, useStripe } from '@stripe/stripe-react-native'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import PatronBottomNav from '../components/PatronBottomNav'
import { supabase } from '../lib/supabase'

const C = {
  bg: '#F7F4EE',
  card: '#FFFFFF',
  border: '#E6DED2',
  title: '#171614',
  text: '#2A2723',
  textSoft: '#6D675E',
  textMuted: '#9A9388',
  terra: '#C46A3C',
}

type BillingProfile = {
  stripe_customer_id: string | null
  default_payment_method_id: string | null
  default_payment_method_brand: string | null
  default_payment_method_last4: string | null
  default_payment_method_exp_month: number | null
  default_payment_method_exp_year: number | null
}

export default function CartePaiementPatron() {
  const router = useRouter()
  const { confirmSetupIntent } = useStripe()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cardComplete, setCardComplete] = useState(false)
  const [billingProfile, setBillingProfile] = useState<BillingProfile | null>(null)
  const [patron, setPatron] = useState<{ prenom: string | null; email: string | null } | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      router.replace('/')
      return
    }

    const [{ data: patronData }, { data: billingData }] = await Promise.all([
      supabase.from('patrons').select('prenom, email').eq('id', user.id).single(),
      supabase
        .from('patron_billing_profiles')
        .select(
          'stripe_customer_id, default_payment_method_id, default_payment_method_brand, default_payment_method_last4, default_payment_method_exp_month, default_payment_method_exp_year'
        )
        .eq('patron_id', user.id)
        .maybeSingle(),
    ])

    setPatron(patronData ?? null)
    setBillingProfile((billingData as BillingProfile | null) ?? null)
    setLoading(false)
  }, [router])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleSaveCard = useCallback(async () => {
    if (!cardComplete || saving) return

    setSaving(true)
    try {
      const { data: setupData, error: setupError } = await supabase.functions.invoke(
        'stripe-create-patron-setup-intent',
        { body: {} }
      )

      if (setupError || !setupData?.clientSecret) {
        Alert.alert('Erreur', setupError?.message ?? setupData?.error ?? 'Impossible de preparer la carte.')
        return
      }

      const { setupIntent, error } = await confirmSetupIntent(setupData.clientSecret, {
        paymentMethodType: 'Card',
        paymentMethodData: {
          billingDetails: {
            email: patron?.email ?? undefined,
            name: patron?.prenom ?? undefined,
          },
        },
      })

      if (error || !setupIntent) {
        Alert.alert('Erreur', error?.message ?? 'Impossible d enregistrer la carte.')
        return
      }

      const paymentMethodId = setupIntent.paymentMethodId ?? setupIntent.paymentMethod?.id ?? null
      if (!paymentMethodId) {
        Alert.alert('Erreur', 'Aucun moyen de paiement n a ete retourne par Stripe.')
        return
      }

      const { data: saveData, error: saveError } = await supabase.functions.invoke(
        'stripe-save-patron-payment-method',
        {
          body: {
            paymentMethodId,
            setupIntentId: setupIntent.id,
          },
        }
      )

      if (saveError) {
        Alert.alert('Erreur', saveError.message ?? 'Impossible de sauvegarder la carte.')
        return
      }

      if (saveData?.error) {
        Alert.alert('Erreur', String(saveData.error))
        return
      }

      await loadData()
      Alert.alert('Carte enregistree', 'Votre carte par defaut a bien ete sauvegardee.')
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Impossible d enregistrer la carte.')
    } finally {
      setSaving(false)
    }
  }, [cardComplete, confirmSetupIntent, loadData, patron?.email, patron?.prenom, saving])

  const cardSummary =
    billingProfile?.default_payment_method_last4 && billingProfile?.default_payment_method_brand
      ? `${billingProfile.default_payment_method_brand.toUpperCase()} •••• ${billingProfile.default_payment_method_last4}`
      : null

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.8}>
            <Text style={s.backTxt}>Retour</Text>
          </TouchableOpacity>
          <Text style={s.title}>Carte patron</Text>
          <Text style={s.sub}>Ajoutez ou remplacez votre carte de paiement par defaut.</Text>
        </View>

        <View style={s.section}>
          <View style={s.cardBox}>
            <Text style={s.sectionTitle}>Carte actuelle</Text>
            {loading ? (
              <Text style={s.muted}>Chargement...</Text>
            ) : cardSummary ? (
              <>
                <Text style={s.cardSummary}>{cardSummary}</Text>
                <Text style={s.muted}>
                  Expire le {String(billingProfile?.default_payment_method_exp_month ?? '').padStart(2, '0')}/
                  {billingProfile?.default_payment_method_exp_year ?? ''}
                </Text>
              </>
            ) : (
              <Text style={s.muted}>Aucune carte par defaut enregistree.</Text>
            )}
          </View>

          <View style={s.cardBox}>
            <Text style={s.sectionTitle}>{cardSummary ? 'Remplacer la carte' : 'Ajouter une carte'}</Text>
            <CardField
              postalCodeEnabled
              placeholders={{ number: '4242 4242 4242 4242' }}
              cardStyle={{
                backgroundColor: '#FFFFFF',
                borderColor: C.border,
                borderWidth: 1,
                borderRadius: 16,
                textColor: C.title,
                placeholderColor: C.textMuted,
              }}
              style={s.cardField}
              onCardChange={(details) => setCardComplete(Boolean(details.complete))}
            />

            <TouchableOpacity
              style={[s.primaryButton, (!cardComplete || saving) && s.primaryButtonDisabled]}
              onPress={() => void handleSaveCard()}
              disabled={!cardComplete || saving}
              activeOpacity={0.85}
            >
              <Text style={s.primaryButtonText}>
                {saving ? 'Enregistrement...' : cardSummary ? 'Mettre a jour la carte' : 'Enregistrer la carte'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      <PatronBottomNav />
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { paddingBottom: 132 },
  header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 8 },
  backTxt: { fontSize: 15, color: C.terra, fontWeight: '700', marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '800', color: C.title, marginBottom: 8, letterSpacing: -0.4 },
  sub: { fontSize: 14, color: C.textSoft, lineHeight: 20 },
  section: { paddingHorizontal: 18, paddingTop: 18 },
  cardBox: {
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: C.title, marginBottom: 10 },
  muted: { fontSize: 13, color: C.textMuted, lineHeight: 19 },
  cardSummary: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 4 },
  cardField: {
    width: '100%',
    height: 54,
    marginTop: 8,
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: C.terra,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    backgroundColor: '#D7B8A5',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
})
