import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ensureAccountProfileForUser } from '../lib/auth-profile-sync'
import { getHomeRouteForRole, getLoginRouteForRole } from '../lib/auth-role'
import { searchFrenchCities, type FrenchCityOption } from '../lib/french-postal'
import { getFriendlySignupError } from '../lib/supabase-errors'
import { supabase } from '../lib/supabase'

const C = {
  bg: '#F7F4EE',
  card: '#FFFDFC',
  border: '#E9DFD2',
  title: '#181511',
  text: '#5D554C',
  muted: '#9A8C7E',
  terra: '#C46A3C',
  terraSoft: '#FFF6ED',
  terraBorder: '#F0C7A8',
  shadow: '#2B2118',
}

export default function InscriptionPatron() {
  const router = useRouter()
  const [nomRestaurant, setNomRestaurant] = useState('')
  const [prenom, setPrenom] = useState('')
  const [email, setEmail] = useState('')
  const [telephone, setTelephone] = useState('')
  const [emailError, setEmailError] = useState('')
  const [locationQuery, setLocationQuery] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [ville, setVille] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [cityOptions, setCityOptions] = useState<FrenchCityOption[]>([])
  const [selectedCity, setSelectedCity] = useState<FrenchCityOption | null>(null)
  const [citiesLoading, setCitiesLoading] = useState(false)
  const [loading, setLoading] = useState(false)

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

  const handleResetPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Information', 'Renseignez votre email pour recevoir le lien de réinitialisation.')
      return
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim())
    if (error) {
      console.error('inscription patron resetPasswordForEmail error', error)
      Alert.alert('Erreur', "Impossible d'envoyer l'email de réinitialisation pour le moment.")
      return
    }

    Alert.alert('Email envoyé', 'Un lien de réinitialisation vient d’être envoyé à votre adresse email.')
  }

  useEffect(() => {
    let cancelled = false

    const loadCities = async () => {
      const normalizedQuery = locationQuery.trim()
      if (normalizedQuery.length < 2) {
        setCityOptions([])
        setCitiesLoading(false)
        return
      }

      setCitiesLoading(true)
      const nextCities = await searchFrenchCities(normalizedQuery)
      if (cancelled) return

      setCityOptions(nextCities)
      setCitiesLoading(false)

      if (!nextCities.some((item) => item.nom === selectedCity?.nom && item.codePostal === selectedCity?.codePostal)) {
        setSelectedCity(null)
        setVille('')
        setPostalCode('')
      }
    }

    loadCities()

    return () => {
      cancelled = true
    }
  }, [locationQuery, selectedCity?.codePostal, selectedCity?.nom])

  const handleSelectCity = (city: FrenchCityOption) => {
    setSelectedCity(city)
    setVille(city.nom)
    setPostalCode(city.codePostal)
    setLocationQuery(`${city.nom} (${city.codePostal})`)
  }

  const handleInscription = async () => {
    if (!nomRestaurant || !prenom || !email || !telephone || !postalCode || !ville || !motDePasse || !selectedCity) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs')
      return
    }

    if (!isValidEmail(email)) {
      setEmailError('Veuillez entrer une adresse email valide')
      return
    }

    setLoading(true)

    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password: motDePasse,
      options: {
        data: {
          account_role: 'patron',
          nom_restaurant: nomRestaurant,
          prenom,
          telephone,
          code_postal: postalCode,
          ville,
          lat: selectedCity.lat,
          lng: selectedCity.lng,
        },
      },
    })

    if (authError) {
      console.error('inscription patron auth.signUp error', authError)
      setLoading(false)
      const lower = String(authError.message ?? '').toLowerCase()
      if (lower.includes('user already registered') || lower.includes('already registered')) {
        Alert.alert(
          'Compte existant',
          'Un compte existe déjà avec cet email. Connectez-vous.',
          [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Mot de passe oublié', onPress: () => void handleResetPassword() },
            { text: 'Se connecter', onPress: () => router.push('/connexion-patron') },
          ]
        )
        return
      }

      Alert.alert('Erreur', getFriendlySignupError(authError))
      return
    }

    if (data.user && data.session) {
      const profileSync = await ensureAccountProfileForUser(data.user)
      if (!profileSync.ok) {
        console.error('inscription patron profile sync error', profileSync)
        setLoading(false)
        Alert.alert('Erreur', "Le compte a été créé, mais le profil patron n'a pas pu être initialisé.")
        return
      }
    }

    setLoading(false)
    const hasSession = Boolean(data.session)
    Alert.alert(
      hasSession ? 'Compte créé' : 'Confirmez votre email',
      hasSession
        ? 'Votre compte patron est prêt.'
        : 'Votre compte a bien été créé. Confirmez votre email pour vous connecter.',
      [
        {
          text: 'Continuer',
          onPress: () => {
            if (hasSession) router.replace(getHomeRouteForRole('patron'))
            else router.replace(getLoginRouteForRole('patron'))
          },
        },
      ]
    )
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>

        <Text style={styles.eyebrow}>RENFORT</Text>
        <Text style={styles.title}>Créer un compte</Text>
        <Text style={styles.subtitle}>
          Lancez votre recherche et trouvez rapidement le bon profil.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Nom du restaurant</Text>
          <TextInput style={styles.input} placeholder="Ex : Brasserie du Vieux Port" placeholderTextColor="#9A9388" value={nomRestaurant} onChangeText={setNomRestaurant} />

          <Text style={styles.label}>Votre prénom</Text>
          <TextInput style={styles.input} placeholder="Ex : Jean" placeholderTextColor="#9A9388" value={prenom} onChangeText={setPrenom} />

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={[styles.input, emailError ? styles.inputError : null]}
            placeholder="jean@restaurant.fr"
            placeholderTextColor="#9A9388"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={(value) => {
              setEmail(value)
              if (!value.trim() || isValidEmail(value)) setEmailError('')
            }}
          />
          {emailError ? <Text style={styles.fieldError}>{emailError}</Text> : null}

          <Text style={styles.label}>Téléphone</Text>
          <TextInput style={styles.input} placeholder="06 00 00 00 00" placeholderTextColor="#9A9388" keyboardType="phone-pad" value={telephone} onChangeText={setTelephone} />

          <Text style={styles.label}>Ville ou code postal</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex : 13600 ou La Ciotat"
            placeholderTextColor="#9A9388"
            autoCapitalize="words"
            value={locationQuery}
            onChangeText={(value) => {
              setLocationQuery(value)
              setSelectedCity(null)
              setVille('')
              setPostalCode('')
            }}
          />

          {locationQuery.trim().length >= 2 && (
            <View style={styles.cityOptionsWrap}>
              {citiesLoading ? (
                <Text style={styles.cityHelper}>Recherche des suggestions...</Text>
              ) : cityOptions.length === 0 ? (
                <Text style={styles.cityHelper}>Aucune ville trouvée</Text>
              ) : (
                cityOptions.map((city) => {
                  const isSelected = selectedCity?.nom === city.nom && selectedCity?.codePostal === city.codePostal
                  return (
                    <TouchableOpacity
                      key={`${city.codePostal}-${city.nom}`}
                      style={[styles.cityOption, isSelected && styles.cityOptionSelected]}
                      onPress={() => handleSelectCity(city)}
                      activeOpacity={0.86}
                    >
                      <Text style={[styles.cityOptionText, isSelected && styles.cityOptionTextSelected]}>
                        {`${city.nom} (${city.codePostal})`}
                      </Text>
                    </TouchableOpacity>
                  )
                })
              )}
            </View>
          )}

          <Text style={styles.label}>Mot de passe</Text>
          <TextInput style={styles.input} placeholder="Minimum 6 caractères" placeholderTextColor="#9A9388" secureTextEntry value={motDePasse} onChangeText={setMotDePasse} />

          <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleInscription} disabled={loading} activeOpacity={0.88}>
            <Text style={styles.buttonText}>{loading ? 'Création en cours...' : 'Créer mon compte'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.loginLink} onPress={() => router.push('/connexion-patron')}>
          <Text style={styles.loginText}>Déjà un compte ? Se connecter</Text>
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
  inputError: {
    borderColor: '#C84B4B',
  },
  fieldError: {
    fontSize: 12,
    color: '#C84B4B',
    fontWeight: '600',
    marginTop: -10,
    marginBottom: 14,
  },
  cityOptionsWrap: { marginTop: -8, marginBottom: 18, gap: 8 },
  cityHelper: { fontSize: 13, color: C.muted, lineHeight: 18 },
  cityOption: {
    backgroundColor: '#FFFCF8',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  cityOptionSelected: { backgroundColor: C.terraSoft, borderColor: C.terraBorder },
  cityOptionText: { fontSize: 14, color: C.title, fontWeight: '600' },
  cityOptionTextSelected: { color: C.terra },
  button: {
    backgroundColor: C.terra,
    borderRadius: 18,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.terra,
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 4,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  loginLink: { alignItems: 'center', marginTop: 20 },
  loginText: { fontSize: 14, color: C.terra, fontWeight: '700' },
})
