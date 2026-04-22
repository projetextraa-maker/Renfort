import { useRouter } from 'expo-router'
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native'

const C = {
  bg: '#F7F4EE',
  card: '#FFFFFF',
  border: '#E9DFD2',
  title: '#181511',
  text: '#5F574C',
  terra: '#C46A3C',
}

export default function BillingSuccessScreen() {
  const router = useRouter()

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <View style={styles.card}>
        <Text style={styles.title}>Abonnement activé</Text>
        <Text style={styles.subtitle}>Votre formule est maintenant active.</Text>

        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
          onPress={() => router.replace('/poster-annonce')}
        >
          <Text style={styles.primaryBtnTxt}>Publier une mission</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg, justifyContent: 'center', paddingHorizontal: 20 },
  card: { backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.border, padding: 24 },
  title: { fontSize: 30, lineHeight: 34, fontWeight: '800', color: C.title, letterSpacing: -0.8, marginBottom: 10 },
  subtitle: { fontSize: 15, lineHeight: 21, color: C.text, marginBottom: 20 },
  primaryBtn: { backgroundColor: C.terra, borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  primaryBtnPressed: { transform: [{ scale: 0.985 }] },
  primaryBtnTxt: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
})
