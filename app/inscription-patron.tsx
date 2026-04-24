import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ensureAccountProfileForUser, inspectAccountStateForUser } from '../lib/auth-profile-sync'
import { getHomeRouteForRole, getLoginRouteForRole } from '../lib/auth-role'
import { searchFrenchCities, type FrenchCityOption } from '../lib/french-postal'
import { getFriendlySignupError } from '../lib/supabase-errors'
import { supabase, SUPABASE_PROJECT_REF, SUPABASE_URL } from '../lib/supabase'

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
  const [cityError, setCityError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState('')
  const [locationQuery, setLocationQuery] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [ville, setVille] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [cityOptions, setCityOptions] = useState<FrenchCityOption[]>([])
  const [selectedCity, setSelectedCity] = useState<FrenchCityOption | null>(null)
  const [citiesLoading, setCitiesLoading] = useState(false)
  const [loading, setLoading] = useState(false)

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  const normalizeCityQuery = (value: string) => value.trim().toLowerCase()

  const finishSignupFlow = (message: string, route: string) => {
    setSubmitError('')
    setSubmitSuccess(message)
    setLoading(false)
    setTimeout(() => router.replace(route as never), 900)
  }

  const handleResetPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Information', 'Renseignez votre email pour recevoir le lien de reinitialisation.')
      return
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim())
    if (error) {
      console.error('inscription patron resetPasswordForEmail error', error)
      Alert.alert('Erreur', "Impossible d'envoyer l'email de reinitialisation pour le moment.")
      return
    }

    Alert.alert('Email envoye', "Un lien de reinitialisation vient d'etre envoye a votre adresse email.")
  }

  const handleRecoverExistingPatronAccount = async () => {
    console.log('[signup:patron] existing-account recovery start', { email })
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: motDePasse,
    })

    console.log('[signup:patron] existing-account recovery auth result', {
      ok: !error,
      message: error?.message ?? null,
      hasUser: Boolean(data.user),
      hasSession: Boolean(data.session),
    })

    if (error || !data.user || !data.session) {
      setSubmitError("Un compte existe deja avec cet email. Connectez-vous ou reinitialisez votre mot de passe.")
      Alert.alert(
        'Compte existant',
        "Cet email est deja utilise. Connectez-vous avec votre mot de passe ou reinitialisez-le si besoin.",
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Mot de passe oublie', onPress: () => void handleResetPassword() },
          { text: 'Se connecter', onPress: () => router.push('/connexion-patron') },
        ]
      )
      return
    }

    console.log('[signup:patron] existing-account inspection start', { userId: data.user.id })
    const accountState = await inspectAccountStateForUser(data.user)
    console.log('[signup:patron] existing-account inspection result', accountState)

    if (!accountState.ok) {
      setSubmitError("Le compte existe deja. Connectez-vous pour continuer.")
      router.replace('/connexion-patron')
      return
    }

    if (accountState.role && accountState.role !== 'patron') {
      setSubmitError("Cet email est deja associe a un compte serveur. Connectez-vous avec le bon espace.")
      Alert.alert(
        'Compte deja existant',
        "Cet email est deja associe a un compte serveur. Connectez-vous depuis l'espace serveur.",
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Se connecter', onPress: () => router.push('/connexion-serveur') },
        ]
      )
      return
    }

    console.log('[signup:patron] existing-account profile sync start', { userId: data.user.id })
    const profileSync = await ensureAccountProfileForUser(data.user)
    console.log('[signup:patron] existing-account profile sync result', profileSync)

    if (!profileSync.ok) {
      setSubmitError("Le compte existe deja, mais sa recuperation a echoue. Connectez-vous pour finaliser la reprise.")
      Alert.alert(
        'Compte existant',
        "Le compte Auth existe deja, mais son profil patron n'a pas pu etre repare automatiquement. Connectez-vous pour finaliser la reprise.",
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Se connecter', onPress: () => router.push('/connexion-patron') },
        ]
      )
      return
    }

    const repairedState = await inspectAccountStateForUser(data.user)
    console.log('[signup:patron] existing-account repaired state', repairedState)
    finishSignupFlow(
      repairedState.ok && (!repairedState.patronExists || repairedState.etablissementCount === 0)
        ? "Votre compte existait deja dans Auth. Le profil patron a ete repare. Redirection en cours..."
        : "Votre compte existe deja. Redirection en cours...",
      getHomeRouteForRole('patron')
    )
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

      const exactMatches = nextCities.filter((city) => {
        const formatted = `${city.nom} (${city.codePostal})`
        return normalizeCityQuery(city.nom) === normalizeCityQuery(normalizedQuery)
          || normalizeCityQuery(formatted) === normalizeCityQuery(normalizedQuery)
          || city.codePostal === normalizedQuery
      })

      if (exactMatches.length === 1) {
        handleSelectCity(exactMatches[0])
        return
      }

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
    setSubmitError('')
    setCityError('')
    setSelectedCity(city)
    setVille(city.nom)
    setPostalCode(city.codePostal)
    setLocationQuery(`${city.nom} (${city.codePostal})`)
  }

  const handleInscription = async () => {
    console.log('[signup:patron] click')
    console.log('[signup:patron] validation start')
    if (!nomRestaurant || !prenom || !email || !telephone || !motDePasse) {
      console.warn('[signup:patron] validation failed', {
        reason: 'missing_required_fields',
        hasNomRestaurant: Boolean(nomRestaurant),
        hasPrenom: Boolean(prenom),
        hasEmail: Boolean(email),
        hasTelephone: Boolean(telephone),
        hasPassword: Boolean(motDePasse),
      })
      setCityError('')
      setSubmitError('Veuillez remplir tous les champs obligatoires avant de continuer.')
      return
    }

    if (!selectedCity) {
      console.warn('[signup:patron] validation failed', {
        reason: 'city_not_selected',
        locationQuery,
        cityOptionsCount: cityOptions.length,
      })
      setCityError('Veuillez selectionner une ville dans la liste')
      setSubmitError('Veuillez selectionner une ville dans la liste avant de continuer.')
      return
    }

    if (!isValidEmail(email)) {
      console.warn('[signup:patron] validation failed', { reason: 'invalid_email', email })
      setEmailError('Veuillez entrer une adresse email valide')
      setSubmitError('Veuillez corriger votre adresse email avant de continuer.')
      return
    }

    setCityError('')
    setSubmitError('')
    setLoading(true)
    console.log('[signup:patron] signup start', {
      supabaseUrl: SUPABASE_URL,
      supabaseProjectRef: SUPABASE_PROJECT_REF,
      emailRaw: email,
      emailTrimmed: email.trim(),
      role: 'patron',
    })

    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
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
      console.log('[signup:patron] signup result', { ok: false, message: authError.message, status: authError.status ?? null })
      console.error('inscription patron auth.signUp error', authError)
      setLoading(false)
      const lower = String(authError.message ?? '').toLowerCase()
      if (lower.includes('user already registered') || lower.includes('already registered')) {
        setLoading(true)
        await handleRecoverExistingPatronAccount()
        setLoading(false)
        return
      }

      setSubmitError(getFriendlySignupError(authError))
      Alert.alert('Erreur', getFriendlySignupError(authError))
      return
    }

    console.log('[signup:patron] signup result', {
      ok: true,
      hasUser: Boolean(data.user),
      hasSession: Boolean(data.session),
      userId: data.user?.id ?? null,
    })

    if (data.user && data.session) {
      console.log('[signup:patron] profile sync start', { userId: data.user.id })
      const profileSync = await ensureAccountProfileForUser(data.user)
      console.log('[signup:patron] profile sync result', profileSync)
      if (!profileSync.ok) {
        console.error('inscription patron profile sync error', profileSync)
        setLoading(false)
        setSubmitError("Le compte a ete cree, mais le profil patron n'a pas pu etre initialise.")
        Alert.alert('Erreur', "Le compte a ete cree, mais le profil patron n'a pas pu etre initialise.")
        return
      }

      if ('warning' in profileSync && profileSync.warning === 'insert_etablissement_failed') {
        finishSignupFlow("Votre compte patron a bien ete cree. L'etablissement initial sera a completer apres connexion.", getHomeRouteForRole('patron'))
        return
      }
    }

    setLoading(false)
    const hasSession = Boolean(data.session)
    console.log('[signup:patron] navigation start', { hasSession })
    if (hasSession) {
      finishSignupFlow('Votre compte patron a bien ete cree. Redirection en cours...', getHomeRouteForRole('patron'))
      return
    }

    finishSignupFlow('Votre compte a bien ete cree. Confirmez votre email puis connectez-vous.', getLoginRouteForRole('patron'))
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>

        <Text style={styles.eyebrow}>RENFORT</Text>
        <Text style={styles.title}>Creer un compte</Text>
        <Text style={styles.subtitle}>
          Lancez votre recherche et trouvez rapidement le bon profil.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Nom du restaurant</Text>
          <TextInput style={styles.input} placeholder="Ex : Brasserie du Vieux Port" placeholderTextColor="#9A9388" value={nomRestaurant} onChangeText={(value) => { setNomRestaurant(value); if (submitError) setSubmitError('') }} />

          <Text style={styles.label}>Votre prenom</Text>
          <TextInput style={styles.input} placeholder="Ex : Jean" placeholderTextColor="#9A9388" value={prenom} onChangeText={(value) => { setPrenom(value); if (submitError) setSubmitError('') }} />

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
              if (submitError) setSubmitError('')
            }}
          />
          {emailError ? <Text style={styles.fieldError}>{emailError}</Text> : null}

          <Text style={styles.label}>Telephone</Text>
          <TextInput style={styles.input} placeholder="06 00 00 00 00" placeholderTextColor="#9A9388" keyboardType="phone-pad" value={telephone} onChangeText={(value) => { setTelephone(value); if (submitError) setSubmitError('') }} />

          <Text style={styles.label}>Ville ou code postal</Text>
          <TextInput
            style={[styles.input, cityError ? styles.inputError : null]}
            placeholder="Ex : 13600 ou La Ciotat"
            placeholderTextColor="#9A9388"
            autoCapitalize="words"
            value={locationQuery}
            onChangeText={(value) => {
              setLocationQuery(value)
              setSelectedCity(null)
              setVille('')
              setPostalCode('')
              if (cityError) setCityError('')
              if (submitError) setSubmitError('')
            }}
          />
          {cityError ? <Text style={styles.fieldError}>{cityError}</Text> : null}

          {locationQuery.trim().length >= 2 && (
            <View style={styles.cityOptionsWrap}>
              {citiesLoading ? (
                <Text style={styles.cityHelper}>Recherche des suggestions...</Text>
              ) : cityOptions.length === 0 ? (
                <Text style={styles.cityHelper}>Aucune ville trouvee</Text>
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
          <TextInput style={styles.input} placeholder="Minimum 6 caracteres" placeholderTextColor="#9A9388" secureTextEntry value={motDePasse} onChangeText={(value) => { setMotDePasse(value); if (submitError) setSubmitError('') }} />

          {submitError ? <Text style={styles.submitError}>{submitError}</Text> : null}
          {submitSuccess ? <Text style={styles.submitSuccess}>{submitSuccess}</Text> : null}

          <Pressable
            style={({ pressed }) => [styles.button, (loading || !selectedCity) && styles.buttonDisabled, pressed && !loading && selectedCity ? styles.buttonPressed : null]}
            onPressIn={() => console.log('CLICK SIGNUP', { role: 'patron', loading, hasSelectedCity: Boolean(selectedCity) })}
            onPress={() => {
              console.log('[signup:patron] button pressed')
              void handleInscription()
            }}
            disabled={loading || !selectedCity}
          >
            <Text style={styles.buttonText}>{loading ? 'Creation en cours...' : 'Creer mon compte'}</Text>
          </Pressable>
        </View>

        <TouchableOpacity style={styles.loginLink} onPress={() => router.push('/connexion-patron')}>
          <Text style={styles.loginText}>Deja un compte ? Se connecter</Text>
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
  submitError: {
    fontSize: 13,
    color: '#C84B4B',
    fontWeight: '600',
    lineHeight: 18,
    marginTop: -4,
    marginBottom: 12,
  },
  submitSuccess: {
    fontSize: 13,
    color: '#2D6A4F',
    fontWeight: '600',
    lineHeight: 18,
    marginTop: -4,
    marginBottom: 12,
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
  buttonPressed: { transform: [{ scale: 0.985 }] },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  loginLink: { alignItems: 'center', marginTop: 20 },
  loginText: { fontSize: 14, color: C.terra, fontWeight: '700' },
})








