import { useRouter } from 'expo-router'
import { ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import PatronBottomNav from './PatronBottomNav'

const C = {
  bg: '#F7F4EE',
  card: '#FFFFFF',
  border: '#E6DED2',
  title: '#171614',
  textSoft: '#6D675E',
  textMuted: '#9A9388',
  terra: '#C46A3C',
}

export default function CartePaiementPatronWeb() {
  const router = useRouter()

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.8}>
            <Text style={s.backTxt}>Retour</Text>
          </TouchableOpacity>
          <Text style={s.title}>Carte patron</Text>
          <Text style={s.sub}>
            Cette page n'est pas disponible sur web. Gerez votre carte bancaire depuis le parcours Stripe
            web d'abonnement.
          </Text>
        </View>

        <View style={s.section}>
          <View style={s.cardBox}>
            <Text style={s.sectionTitle}>Paiement</Text>
            <Text style={s.muted}>
              Sur web, la gestion de la carte bancaire passe par le parcours Stripe d'abonnement.
            </Text>
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
})
