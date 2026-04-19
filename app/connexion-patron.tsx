import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { supabase } from '../lib/supabase'

const C = {
  bg: '#F7F4EE',
  card: '#FFFDFC',
  border: '#E9DFD2',
  title: '#181511',
  text: '#5D554C',
  muted: '#9A8C7E',
  terra: '#C46A3C',
  terraDark: '#9F542D',
  shadow: '#2B2118',
}

export default function ConnexionPatron() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [loading, setLoading] = useState(false)

  const handleConnexion = async () => {
    if (!email || !motDePasse) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs')
      return
    }

    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: motDePasse,
    })
    setLoading(false)

    if (error || !data.user) {
      Alert.alert('Erreur', 'Email ou mot de passe incorrect')
    } else {
      router.push('/dashboard_patron')
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>

        <Text style={styles.eyebrow}>RENFORT</Text>
        <Text style={styles.title}>Se connecter</Text>
        <Text style={styles.subtitle}>
          Retrouvez vos missions et publiez rapidement votre prochain besoin.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="jean@restaurant.fr"
            placeholderTextColor="#9A9388"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={styles.label}>Mot de passe</Text>
          <TextInput
            style={styles.input}
            placeholder="Votre mot de passe"
            placeholderTextColor="#9A9388"
            secureTextEntry
            value={motDePasse}
            onChangeText={setMotDePasse}
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleConnexion}
            disabled={loading}
            activeOpacity={0.88}
          >
            <Text style={styles.buttonText}>{loading ? 'Connexion...' : 'Se connecter'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.registerLink} onPress={() => router.push('/inscription-patron')}>
          <Text style={styles.registerText}>Pas encore de compte ? Créer un compte</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 24, paddingTop: 58, paddingBottom: 36 },
  back: { alignSelf: 'flex-start', marginBottom: 18 },
  backText: { fontSize: 15, color: C.terra, fontWeight: '700' },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.6, color: C.muted, marginBottom: 12 },
  title: { fontSize: 34, lineHeight: 40, fontWeight: '900', color: C.title, letterSpacing: -0.9, marginBottom: 12 },
  subtitle: { fontSize: 16, lineHeight: 24, color: C.text, marginBottom: 24, maxWidth: 320 },
  card: {
    backgroundColor: C.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    shadowColor: C.shadow,
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    elevation: 4,
  },
  label: { fontSize: 14, fontWeight: '700', color: C.title, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 15,
    fontSize: 15,
    color: C.title,
    backgroundColor: '#FFFCF8',
    marginBottom: 18,
  },
  button: {
    backgroundColor: C.terra,
    borderRadius: 18,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: C.terra,
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 4,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  registerLink: { alignItems: 'center', marginTop: 20 },
  registerText: { fontSize: 14, color: C.terra, fontWeight: '700' },
})
