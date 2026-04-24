import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ensureAccountProfileForUser, inspectAccountStateForUser } from '../lib/auth-profile-sync'
import { getHomeRouteForRole, getLoginRouteForRole } from '../lib/auth-role'
import { searchFrenchCities, type FrenchCityOption } from '../lib/french-postal'
import { resolveReferrerIdFromCode } from '../lib/referrals'
import { getFriendlySignupError } from '../lib/supabase-errors'
import { supabase, SUPABASE_PROJECT_REF, SUPABASE_URL } from '../lib/supabase'

const C = {
  bg: '#F7F4EE',
  card: '#FFFDFC',
  border: '#E9DFD2',
  title: '#181511',
  text: '#5D554C',
  muted: '#9A8C7E',
  terra: '#1F6B45',
  terraSoft: '#F1F8F3',
  terraBorder: '#C7DDCD',
  shadow: '#2B2118',
}

export default function InscriptionServeur() {
  const router = useRouter()
  const [prenom, setPrenom] = useState('')
  const [nom, setNom] = useState('')
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
  const [referralCodeInput, setReferralCodeInput] = useState('')
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
      Alert.alert('Information', 'Renseignez votre email pour recevoir le lien de rÃ©initialisation.')
      return
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim())
    if (error) {
      console.error('inscription serveur resetPasswordForEmail error', error)
      Alert.alert('Erreur', "Impossible d'envoyer l'email de rÃ©initialisation pour le moment.")
      return
    }

    Alert.alert('Email envoyÃ©', 'Un lien de rÃ©initialisation vient dâ€™Ãªtre envoyÃ© Ã  votre adresse email.')
  }

  const handleRecoverExistingServeurAccount = async () => {
    console.log('[signup:serveur] existing-account recovery start', { email })
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: motDePasse,
    })

    console.log('[signup:serveur] existing-account recovery auth result', {
      ok: !error,
      message: error?.message ?? null,
      hasUser: Boolean(data.user),
      hasSession: Boolean(data.session),
    })

    if (error || !data.user || !data.session) {
      setSubmitError("Un compte existe dÃ©jÃ  avec cet email. Connectez-vous ou rÃ©initialisez votre mot de passe.")
      Alert.alert(
        'Compte existant',
        "Cet email est dÃ©jÃ  utilisÃ©. Connectez-vous avec votre mot de passe ou rÃ©initialisez-le si besoin.",
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Mot de passe oubliÃ©', onPress: () => void handleResetPassword() },
          { text: 'Se connecter', onPress: () => router.push('/connexion-serveur') },
        ]
      )
      return
    }

    console.log('[signup:serveur] existing-account inspection start', { userId: data.user.id })
    const accountState = await inspectAccountStateForUser(data.user)
    console.log('[signup:serveur] existing-account inspection result', accountState)

    if (!accountState.ok) {
      setSubmitError("Le compte existe dÃ©jÃ . Connectez-vous pour continuer.")
      router.replace('/connexion-serveur')
      return
    }

    if (accountState.role && accountState.role !== 'serveur') {
      setSubmitError("Cet email est déjà associé à un compte patron. Connectez-vous avec le bon espace.")
      Alert.alert(
        'Compte déjà existant',
        "Cet email est déjà associé à un compte patron. Connectez-vous depuis l'espace patron.",
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Se connecter', onPress: () => router.push('/connexion-patron') },
        ]
      )
      return
    }

    console.log('[signup:serveur] existing-account profile sync start', { userId: data.user.id })
    const profileSync = await ensureAccountProfileForUser(data.user)
    console.log('[signup:serveur] existing-account profile sync result', profileSync)

    if (!profileSync.ok) {
      setSubmitError("Le compte existe déjà, mais sa récupération a échoué. Connectez-vous pour finaliser la reprise.")
      Alert.alert(
        'Compte existant',
        "Le compte Auth existe déjà, mais le profil serveur n'a pas pu être réparé automatiquement. Connectez-vous pour finaliser la reprise.",
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Se connecter', onPress: () => router.push('/connexion-serveur') },
        ]
      )
      return
    }

    const repairedState = await inspectAccountStateForUser(data.user)
    console.log('[signup:serveur] existing-account repaired state', repairedState)
    finishSignupFlow(
      repairedState.ok && !repairedState.serveurExists
        ? "Votre compte existait déjà dans Auth. Le profil serveur a été réparé. Redirection en cours..."
        : "Votre compte existe déjà. Redirection en cours...",
      getHomeRouteForRole('serveur')
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
    console.log('[signup:serveur] click')
    console.log('[signup:serveur] validation start')
    if (!prenom || !nom || !email || !telephone || !postalCode || !ville || !motDePasse || !selectedCity) {
      console.warn('[signup:serveur] validation failed', {
        hasPrenom: Boolean(prenom),
        hasNom: Boolean(nom),
        hasEmail: Boolean(email),
        hasTelephone: Boolean(telephone),
        hasPostalCode: Boolean(postalCode),
        hasVille: Boolean(ville),
        hasPassword: Boolean(motDePasse),
        hasSelectedCity: Boolean(selectedCity),
      })
      setSubmitError('Veuillez remplir tous les champs et sélectionner une ville dans la liste.')
      Alert.alert('Erreur', 'Veuillez remplir tous les champs')
      return
    }

    if (!isValidEmail(email)) {
      console.warn('[signup:serveur] validation failed', { reason: 'invalid_email', email })
      setEmailError('Veuillez entrer une adresse email valide')
      setSubmitError('Veuillez corriger votre adresse email avant de continuer.')
      return
    }

    setSubmitError('')
    setLoading(true)

    let referredBy: string | null = null
    if (referralCodeInput.trim()) {
      const referralLookup = await resolveReferrerIdFromCode(referralCodeInput)
      if (!referralLookup.referrerId) {
        console.warn('[signup:serveur] validation failed', { reason: 'invalid_referral_code' })
        setLoading(false)
        setSubmitError('Le code parrain saisi est invalide.')
        Alert.alert('Erreur', 'Code parrain invalide')
        return
      }
      referredBy = referralLookup.referrerId
    }

    console.log('[signup:serveur] signup start', {
      supabaseUrl: SUPABASE_URL,
      supabaseProjectRef: SUPABASE_PROJECT_REF,
      emailRaw: email,
      emailTrimmed: email.trim(),
      role: 'serveur',
    })
    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password: motDePasse,
      options: {
        data: {
          account_role: 'serveur',
          prenom,
          nom,
          telephone,
          code_postal: postalCode,
          ville,
          lat: selectedCity.lat,
          lng: selectedCity.lng,
          rayon: 50,
          referred_by: referredBy,
        },
      },
    })

    if (authError) {
      console.log('[signup:serveur] signup result', { ok: false, message: authError.message, status: authError.status ?? null })
      console.error('inscription serveur auth.signUp error', authError)
      setLoading(false)
      const lower = String(authError.message ?? '').toLowerCase()
      if (lower.includes('user already registered') || lower.includes('already registered')) {
        setLoading(true)
        await handleRecoverExistingServeurAccount()
        setLoading(false)
        return
      }

      setSubmitError(getFriendlySignupError(authError))
      Alert.alert('Erreur', getFriendlySignupError(authError))
      return
    }

    console.log('[signup:serveur] signup result', {
      ok: true,
      hasUser: Boolean(data.user),
      hasSession: Boolean(data.session),
      userId: data.user?.id ?? null,
    })

    if (data.user && data.session) {
      console.log('[signup:serveur] profile sync start', { userId: data.user.id })
      const profileSync = await ensureAccountProfileForUser(data.user)
      console.log('[signup:serveur] profile sync result', profileSync)
      if (!profileSync.ok) {
        console.error('inscription serveur profile sync error', profileSync)
        setLoading(false)
        setSubmitError("Le compte a été créé, mais le profil serveur n'a pas pu être initialisé.")
        Alert.alert('Erreur', "Le compte a été créé, mais le profil serveur n'a pas pu être initialisé.")
        return
      }
    }

    setLoading(false)
    const hasSession = Boolean(data.session)
    console.log('[signup:serveur] navigation start', { hasSession })
    if (hasSession) {
      finishSignupFlow('Votre compte serveur a bien été créé. Redirection en cours...', getHomeRouteForRole('serveur'))
      return
    }

    finishSignupFlow('Votre compte a bien été créé. Confirmez votre email puis connectez-vous.', getLoginRouteForRole('serveur'))
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>

        <Text style={styles.eyebrow}>RENFORT</Text>
        <Text style={styles.title}>CrÃ©er un compte</Text>
        <Text style={styles.subtitle}>
          Rejoignez Renfort et accÃ©dez rapidement aux extras autour de vous.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>PrÃ©nom</Text>
          <TextInput style={styles.input} placeholder="Ex : Thomas" placeholderTextColor="#9A9388" value={prenom} onChangeText={(value) => { setPrenom(value); if (submitError) setSubmitError('') }} />

          <Text style={styles.label}>Nom</Text>
          <TextInput style={styles.input} placeholder="Ex : Martin" placeholderTextColor="#9A9388" value={nom} onChangeText={(value) => { setNom(value); if (submitError) setSubmitError('') }} />

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={[styles.input, emailError ? styles.inputError : null]}
            placeholder="thomas@email.fr"
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

          <Text style={styles.label}>TÃ©lÃ©phone</Text>
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
                <Text style={styles.cityHelper}>Aucune ville trouvÃ©e</Text>
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
          <TextInput style={styles.input} placeholder="Minimum 6 caractÃ¨res" placeholderTextColor="#9A9388" secureTextEntry value={motDePasse} onChangeText={(value) => { setMotDePasse(value); if (submitError) setSubmitError('') }} />

          <Text style={styles.label}>Code parrain (optionnel)</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex : MARC123"
            placeholderTextColor="#9A9388"
            autoCapitalize="characters"
            value={referralCodeInput}
            onChangeText={(value) => { setReferralCodeInput(value); if (submitError) setSubmitError('') }}
          />

          {submitError ? <Text style={styles.submitError}>{submitError}</Text> : null}
          {submitSuccess ? <Text style={styles.submitSuccess}>{submitSuccess}</Text> : null}

          <Pressable
            style={({ pressed }) => [styles.button, (loading || !selectedCity) && styles.buttonDisabled, pressed && !loading && selectedCity ? styles.buttonPressed : null]}
            onPressIn={() => console.log('CLICK SIGNUP', { role: 'serveur', loading, hasSelectedCity: Boolean(selectedCity) })}
            onPress={() => {
              console.log('[signup:serveur] button pressed')
              void handleInscription()
            }}
            disabled={loading || !selectedCity}
          >
            <Text style={styles.buttonText}>{loading ? 'CrÃ©ation en cours...' : 'CrÃ©er mon compte'}</Text>
          </Pressable>
        </View>

        <TouchableOpacity style={styles.loginLink} onPress={() => router.push('/connexion-serveur')}>
          <Text style={styles.loginText}>DÃ©jÃ  un compte ? Se connecter</Text>
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
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.6, color: C.terra, marginBottom: 12 },
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





