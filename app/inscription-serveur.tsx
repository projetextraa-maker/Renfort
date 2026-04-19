import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { fetchCitiesByPostalCode, type FrenchCityOption } from '../lib/french-postal'
import { buildReferralCode, resolveReferrerIdFromCode } from '../lib/referrals'
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

export default function InscriptionServeur() {
  const router = useRouter()
  const [prenom, setPrenom] = useState('')
  const [nom, setNom] = useState('')
  const [email, setEmail] = useState('')
  const [telephone, setTelephone] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [ville, setVille] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [referralCodeInput, setReferralCodeInput] = useState('')
  const [cityOptions, setCityOptions] = useState<FrenchCityOption[]>([])
  const [selectedCity, setSelectedCity] = useState<FrenchCityOption | null>(null)
  const [citiesLoading, setCitiesLoading] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    const loadCities = async () => {
      if (postalCode.length !== 5) {
        setCityOptions([])
        setSelectedCity(null)
        setVille('')
        setCitiesLoading(false)
        return
      }

      setCitiesLoading(true)
      const nextCities = await fetchCitiesByPostalCode(postalCode)

      if (cancelled) return

      setCityOptions(nextCities)
      setCitiesLoading(false)

      if (!nextCities.some((item) => item.nom === selectedCity?.nom && item.codePostal === selectedCity?.codePostal)) {
        setSelectedCity(null)
        setVille('')
      }
    }

    loadCities()

    return () => {
      cancelled = true
    }
  }, [postalCode, selectedCity?.codePostal, selectedCity?.nom])

  const handleSelectCity = (city: FrenchCityOption) => {
    setSelectedCity(city)
    setVille(city.nom)
    setPostalCode(city.codePostal)
  }

  const handleInscription = async () => {
    if (!prenom || !nom || !email || !telephone || !postalCode || !ville || !motDePasse || !selectedCity) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs')
      return
    }

    setLoading(true)

    let referredBy: string | null = null
    if (referralCodeInput.trim()) {
      const referralLookup = await resolveReferrerIdFromCode(referralCodeInput)
      if (!referralLookup.referrerId) {
        setLoading(false)
        Alert.alert('Erreur', 'Code parrain invalide')
        return
      }
      referredBy = referralLookup.referrerId
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password: motDePasse,
    })

    if (authError || !authData.user) {
      setLoading(false)
      Alert.alert('Erreur', authError?.message || 'Erreur lors de la creation du compte')
      return
    }

    const { error: dbError } = await supabase.from('serveurs').insert([{
      id: authData.user.id,
      prenom,
      nom,
      email,
      telephone,
      code_postal: postalCode,
      ville,
      lat: selectedCity.lat,
      lng: selectedCity.lng,
      rayon: 50,
      referral_code: buildReferralCode(prenom, authData.user.id),
      referred_by: referredBy,
    }])

    setLoading(false)
    if (dbError) {
      Alert.alert('Erreur', dbError.message)
    } else {
      router.replace('/(server-tabs)/missions')
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
        <Text style={styles.title}>Creer un compte</Text>
        <Text style={styles.subtitle}>
          Rejoignez Renfort et accedez rapidement aux extras autour de vous.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Prenom</Text>
          <TextInput style={styles.input} placeholder="Ex : Thomas" placeholderTextColor="#9A9388" value={prenom} onChangeText={setPrenom} />

          <Text style={styles.label}>Nom</Text>
          <TextInput style={styles.input} placeholder="Ex : Martin" placeholderTextColor="#9A9388" value={nom} onChangeText={setNom} />

          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} placeholder="thomas@email.fr" placeholderTextColor="#9A9388" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} />

          <Text style={styles.label}>Telephone</Text>
          <TextInput style={styles.input} placeholder="06 00 00 00 00" placeholderTextColor="#9A9388" keyboardType="phone-pad" value={telephone} onChangeText={setTelephone} />

          <Text style={styles.label}>Code postal</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex : 83270"
            placeholderTextColor="#9A9388"
            keyboardType="number-pad"
            maxLength={5}
            value={postalCode}
            onChangeText={(value) => setPostalCode(value.replace(/\D/g, ''))}
          />

          <Text style={styles.label}>Ville</Text>
          <View style={[styles.input, styles.cityField, postalCode.length !== 5 && styles.cityFieldDisabled]}>
            <Text style={ville ? styles.cityFieldText : styles.cityFieldPlaceholder}>
              {ville || (postalCode.length === 5 ? 'Selectionnez votre ville' : 'Entrez un code postal valide')}
            </Text>
          </View>

          {postalCode.length === 5 && (
            <View style={styles.cityOptionsWrap}>
              {citiesLoading ? (
                <Text style={styles.cityHelper}>Recherche des villes...</Text>
              ) : cityOptions.length === 0 ? (
                <Text style={styles.cityHelper}>Aucune ville trouvee pour ce code postal</Text>
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
                        {city.nom}
                      </Text>
                    </TouchableOpacity>
                  )
                })
              )}
            </View>
          )}

          <Text style={styles.label}>Mot de passe</Text>
          <TextInput style={styles.input} placeholder="Minimum 6 caracteres" placeholderTextColor="#9A9388" secureTextEntry value={motDePasse} onChangeText={setMotDePasse} />

          <Text style={styles.label}>Code parrain (optionnel)</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex : MARC123"
            placeholderTextColor="#9A9388"
            autoCapitalize="characters"
            value={referralCodeInput}
            onChangeText={setReferralCodeInput}
          />

          <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleInscription} disabled={loading} activeOpacity={0.88}>
            <Text style={styles.buttonText}>{loading ? 'Creation en cours...' : 'Creer mon compte'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.loginLink} onPress={() => router.push('/connexion-serveur')}>
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
  cityField: {
    justifyContent: 'center',
  },
  cityFieldDisabled: {
    backgroundColor: '#F6F1EB',
  },
  cityFieldText: {
    fontSize: 15,
    color: C.title,
    fontWeight: '600',
  },
  cityFieldPlaceholder: {
    fontSize: 15,
    color: '#9A9388',
  },
  cityOptionsWrap: {
    marginTop: -8,
    marginBottom: 18,
    gap: 8,
  },
  cityHelper: {
    fontSize: 13,
    color: C.muted,
    lineHeight: 18,
  },
  cityOption: {
    backgroundColor: '#FFFCF8',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  cityOptionSelected: {
    backgroundColor: C.terraSoft,
    borderColor: C.terraBorder,
  },
  cityOptionText: {
    fontSize: 14,
    color: C.title,
    fontWeight: '600',
  },
  cityOptionTextSelected: {
    color: C.terra,
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
  loginLink: { alignItems: 'center', marginTop: 20 },
  loginText: { fontSize: 14, color: C.terra, fontWeight: '700' },
})
