import { useRouter } from 'expo-router'
import { StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

const C = {
  bg: '#F7F4EE',
  bgWarm: '#F3E6D8',
  card: '#FFFDFC',
  border: '#E9DFD2',
  title: '#181511',
  text: '#5D554C',
  muted: '#9A8C7E',
  terra: '#C46A3C',
  terraDark: '#9F542D',
  shadow: '#2B2118',
}

export default function PatronScreen() {
  const router = useRouter()

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <View style={styles.bgCircleTop} />
      <View style={styles.bgCircleBottom} />

      <View style={styles.container}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>RENFORT</Text>
          <Text style={styles.title}>Trouver un Renfort</Text>
          <Text style={styles.subtitle}>
            Publiez une mission et trouvez rapidement le bon profil.
          </Text>
        </View>

        <View style={styles.card}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.push('/connexion-patron')}
            activeOpacity={0.88}
          >
            <Text style={styles.primaryButtonText}>Se connecter</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.push('/inscription-patron')}
            activeOpacity={0.88}
          >
            <Text style={styles.secondaryButtonText}>Créer un compte</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.bg,
  },
  bgCircleTop: {
    position: 'absolute',
    top: -110,
    right: -26,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: C.bgWarm,
    opacity: 0.92,
  },
  bgCircleBottom: {
    position: 'absolute',
    bottom: 46,
    left: -54,
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: '#F8EEE4',
    opacity: 0.96,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 58,
    paddingBottom: 28,
    justifyContent: 'space-between',
  },
  back: {
    alignSelf: 'flex-start',
  },
  backText: {
    fontSize: 15,
    fontWeight: '700',
    color: C.terra,
  },
  hero: {
    marginTop: 24,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.8,
    color: C.muted,
    marginBottom: 14,
  },
  title: {
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '900',
    letterSpacing: -1.1,
    color: C.title,
    marginBottom: 14,
    maxWidth: 300,
  },
  subtitle: {
    fontSize: 17,
    lineHeight: 27,
    color: C.text,
    fontWeight: '500',
    maxWidth: 320,
  },
  card: {
    backgroundColor: C.card,
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: C.shadow,
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    elevation: 5,
  },
  primaryButton: {
    backgroundColor: C.terra,
    borderRadius: 20,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: C.terra,
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 4,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  secondaryButton: {
    backgroundColor: '#FFF8F2',
    borderRadius: 20,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E7C9B4',
  },
  secondaryButtonText: {
    color: C.terraDark,
    fontSize: 17,
    fontWeight: '800',
  },
})
