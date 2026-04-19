import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { EURO } from '../lib/currency'
import { getIncludedMissionsForPlan } from '../lib/subscription'
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
  const [loadingPlan, setLoadingPlan] = useState<'pro' | 'pro_plus' | null>(null)

  const activerAbonnement = async (plan: 'pro' | 'pro_plus') => {
    try {
      setLoadingPlan(plan)
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        Alert.alert('Erreur', 'Utilisateur introuvable')
        return
      }

      const { error } = await supabase
        .from('patrons')
        .update({
          abonnement: plan,
          missions_incluses: getIncludedMissionsForPlan(plan),
          missions_utilisees_ce_mois: 0,
          missions_hors_forfait_ce_mois: 0,
          date_debut_periode: new Date().toISOString(),
        })
        .eq('id', user.id)

      if (error) {
        Alert.alert('Erreur', "Impossible d'activer l'abonnement")
        return
      }

      Alert.alert(
        'Abonnement active',
        plan === 'pro' ? 'Abonnement Pro active' : 'Abonnement Pro+ active',
        [{ text: 'OK', onPress: () => router.replace('/dashboard_patron') }]
      )
    } catch (e) {
      console.error('activerAbonnement error:', e)
      Alert.alert('Erreur', "Impossible d'activer l'abonnement")
    } finally {
      setLoadingPlan(null)
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Text style={styles.backTxt}>Retour</Text>
        </TouchableOpacity>

        <Text style={styles.eyebrow}>ABONNEMENT</Text>
        <Text style={styles.title}>Choisissez la formule adaptee a votre etablissement</Text>
        <Text style={styles.subtitle}>
          Comparez les offres Renfort et choisissez la formule la plus adaptee a votre volume
          de missions realisees.
        </Text>

        <View style={[styles.card, styles.cardFeatured]}>
          <View style={styles.badge}>
            <Text style={styles.badgeTxt}>Recommande</Text>
          </View>
          <Text style={styles.planName}>Offre Pro</Text>
          <Text style={styles.planPrice}>{`49${EURO} / mois`}</Text>
          <Text style={styles.planFeature}>10 missions realisees incluses / mois</Text>
          <Text style={styles.planFeature}>{`+5${EURO} par mission realisee supplementaire`}</Text>
          <View style={[styles.annualBlock, styles.annualBlockFeatured]}>
            <Text style={styles.annualPrice}>{`540${EURO} / an`}</Text>
            <Text style={styles.annualHint}>1 mois offert avec l&apos;abonnement annuel</Text>
          </View>
          <TouchableOpacity
            style={[styles.planBtn, styles.planBtnFeatured, loadingPlan === 'pro' && styles.planBtnDisabled]}
            onPress={() => activerAbonnement('pro')}
            activeOpacity={0.88}
            disabled={loadingPlan !== null}
          >
            <Text style={styles.planBtnTxt}>
              {loadingPlan === 'pro' ? 'Activation...' : 'Passer au Pro'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, styles.cardProPlus]}>
          <View style={styles.subtleBadge}>
            <Text style={styles.subtleBadgeTxt}>Option avancee</Text>
          </View>
          <Text style={styles.planName}>Offre Pro+</Text>
          <Text style={[styles.planPrice, styles.planPriceProPlus]}>{`89${EURO} / mois`}</Text>
          <Text style={styles.planFeature}>25 missions realisees incluses / mois</Text>
          <Text style={styles.planFeature}>{`+4${EURO} par mission realisee supplementaire`}</Text>
          <View style={styles.annualBlock}>
            <Text style={styles.annualPrice}>{`990${EURO} / an`}</Text>
            <Text style={styles.annualHint}>1 mois offert avec l&apos;abonnement annuel</Text>
          </View>
          <TouchableOpacity
            style={[styles.planBtn, styles.planBtnSecondary, loadingPlan === 'pro_plus' && styles.planBtnDisabled]}
            onPress={() => activerAbonnement('pro_plus')}
            activeOpacity={0.88}
            disabled={loadingPlan !== null}
          >
            <Text style={[styles.planBtnTxt, styles.planBtnSecondaryTxt]}>
              {loadingPlan === 'pro_plus' ? 'Activation...' : 'Passer au Pro+'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footnote}>Les missions realisees incluses sont renouvelees chaque mois</Text>
        <Text style={styles.commitmentText}>Sans engagement • Annulable a tout moment</Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 40 },
  backBtn: { alignSelf: 'flex-start', marginBottom: 18 },
  backTxt: { color: C.terra, fontSize: 15, fontWeight: '700' },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: C.muted, marginBottom: 10 },
  title: { fontSize: 30, lineHeight: 34, fontWeight: '800', color: C.title, letterSpacing: -0.8, marginBottom: 12 },
  subtitle: { fontSize: 15, lineHeight: 22, color: C.text, marginBottom: 22 },

  card: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 18, marginBottom: 14 },
  cardFeatured: { backgroundColor: C.terraSoft, borderColor: C.terraBorder, borderWidth: 1.5, shadowColor: C.terra, shadowOpacity: 0.14, shadowOffset: { width: 0, height: 12 }, shadowRadius: 24, elevation: 7 },
  cardProPlus: { backgroundColor: '#FFFEFC', borderColor: '#E7DED2', shadowColor: '#181511', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 6 }, shadowRadius: 14, elevation: 2 },

  badge: { alignSelf: 'flex-start', backgroundColor: '#FCE2D2', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 12 },
  badgeTxt: { color: C.terra, fontSize: 12, fontWeight: '700' },
  subtleBadge: { alignSelf: 'flex-start', backgroundColor: '#F6F1EA', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 12 },
  subtleBadgeTxt: { color: '#7C7063', fontSize: 12, fontWeight: '700' },

  planName: { fontSize: 20, fontWeight: '800', color: C.title, marginBottom: 4 },
  planPrice: { fontSize: 17, fontWeight: '800', color: C.terra, marginBottom: 10 },
  planPriceProPlus: { color: '#7C7063' },
  planFeature: { fontSize: 14, lineHeight: 20, color: C.text, marginTop: 2 },

  annualBlock: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  annualBlockFeatured: { borderTopColor: '#EED1BD' },
  annualPrice: { fontSize: 15, fontWeight: '800', color: C.title, marginBottom: 4 },
  annualHint: { fontSize: 13, lineHeight: 18, color: C.terra, fontWeight: '600' },

  planBtn: { marginTop: 14, borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  planBtnFeatured: { backgroundColor: C.terra, shadowColor: C.terra, shadowOpacity: 0.18, shadowOffset: { width: 0, height: 10 }, shadowRadius: 18, elevation: 5 },
  planBtnSecondary: { backgroundColor: C.greenSoft, borderWidth: 1, borderColor: C.greenBorder, shadowColor: '#181511', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 6 }, shadowRadius: 12, elevation: 2 },
  planBtnTxt: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  planBtnSecondaryTxt: { color: '#2A6E4A' },
  planBtnDisabled: { opacity: 0.7 },

  footnote: { fontSize: 13, lineHeight: 19, color: C.muted, textAlign: 'center', marginTop: 4, marginBottom: 14 },
  commitmentText: { fontSize: 13, lineHeight: 19, color: C.muted, textAlign: 'center', marginBottom: 8 },
})
