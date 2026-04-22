import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Alert, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { fetchCitiesByPostalCode, type FrenchCityOption } from '../lib/french-postal'
import { buildEtablissementWritePayload, fetchEtablissementsForPatron, setDefaultEtablissement, type Etablissement } from '../lib/etablissements'
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
  terraBg: '#FEF3EB',
  terraBd: '#F5C9A9',
  green: '#2E8B57',
  greenBg: '#F0F8F3',
  greenBd: '#C0DEC8',
  red: '#C84B4B',
  redBg: '#FEF2F2',
  redBd: '#F2CACA',
}

type Draft = {
  id?: string
  nom: string
  adresse: string
  code_postal: string
  ville: string
  lat: number | null
  lng: number | null
}

const EMPTY_DRAFT: Draft = {
  nom: '',
  adresse: '',
  code_postal: '',
  ville: '',
  lat: null,
  lng: null,
}

function validateDraft(draft: Draft) {
  if (!draft.nom.trim()) return "Veuillez renseigner le nom de l'établissement."
  if (draft.nom.trim().length < 2) return "Le nom de l'établissement est trop court."
  if (!draft.code_postal || draft.code_postal.length !== 5) return 'Veuillez renseigner un code postal valide.'
  if (!draft.ville) return 'Veuillez sélectionner une ville.'
  return null
}

function getFriendlySaveError(errorMessage: string) {
  const lower = errorMessage.toLowerCase()
  if (lower.includes('"name"') && lower.includes('null value')) {
    return "Le nom de l'établissement est obligatoire."
  }
  if (lower.includes('"nom"') && lower.includes('null value')) {
    return "Le nom de l'établissement est obligatoire."
  }
  if (lower.includes('"ville"') && lower.includes('null value')) {
    return "La ville de l'établissement est obligatoire. Sélectionnez une ville avant d'enregistrer."
  }
  if (lower.includes('"adresse"')) {
    return "L'adresse n'a pas pu être enregistrée. Vérifiez le champ adresse."
  }
  return "Impossible d'enregistrer cet établissement pour le moment."
}

function getFriendlyGenericError() {
  return 'Une erreur est survenue. Vérifiez les champs obligatoires et réessayez.'
}

export default function MesEtablissements() {
  const router = useRouter()
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [etablissements, setEtablissements] = useState<Etablissement[]>([])
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [cityOptions, setCityOptions] = useState<FrenchCityOption[]>([])
  const [citiesLoading, setCitiesLoading] = useState(false)

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      router.replace('/')
      return
    }

    setUserId(user.id)
    const next = await fetchEtablissementsForPatron(user.id)
    setEtablissements(next)
    setLoading(false)
  }, [router])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  useEffect(() => {
    let cancelled = false

    const loadCities = async () => {
      if (draft.code_postal.length !== 5) {
        setCityOptions([])
        setCitiesLoading(false)
        return
      }

      setCitiesLoading(true)
      const nextCities = await fetchCitiesByPostalCode(draft.code_postal)
      if (cancelled) return
      setCityOptions(nextCities)
      setCitiesLoading(false)
    }

    loadCities()

    return () => {
      cancelled = true
    }
  }, [draft.code_postal])

  const resetDraft = () => setDraft(EMPTY_DRAFT)

  const editEtablissement = (item: Etablissement) => {
    setDraft({
      id: item.id,
      nom: item.nom,
      adresse: item.adresse ?? '',
      code_postal: '',
      ville: item.ville,
      lat: item.lat,
      lng: item.lng,
    })
  }

  const selectCity = (city: FrenchCityOption) => {
    setDraft((prev) => ({
      ...prev,
      code_postal: city.codePostal,
      ville: city.nom,
      lat: city.lat,
      lng: city.lng,
    }))
  }

  const saveEtablissement = async () => {
    if (!userId) return

    const validationError = validateDraft(draft)
    if (validationError) {
      Alert.alert('Erreur', validationError)
      return
    }

    setSaving(true)
    const existingItem = draft.id ? etablissements.find((item) => item.id === draft.id) : null
    const payload = buildEtablissementWritePayload({
      user_id: userId,
      nom: draft.nom.trim(),
      adresse: draft.adresse.trim() || null,
      ville: draft.ville,
      lat: draft.lat,
      lng: draft.lng,
      is_default: draft.id ? existingItem?.is_default ?? false : etablissements.length === 0,
    })

    let errorMessage: string | null = null

    if (draft.id) {
      const { error } = await supabase.from('etablissements').update(payload).eq('id', draft.id)
      if (error) errorMessage = error.message
    } else {
      const { error } = await supabase.from('etablissements').insert(payload)
      if (error) errorMessage = error.message
    }

    setSaving(false)

    if (errorMessage) {
      Alert.alert('Erreur', getFriendlySaveError(errorMessage))
      return
    }

    resetDraft()
    await load()
  }

  const deleteEtablissement = async (item: Etablissement) => {
    Alert.alert('Supprimer', `Supprimer ${item.nom} ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('etablissements').delete().eq('id', item.id)
          if (error) {
            Alert.alert('Erreur', getFriendlyGenericError())
            return
          }
          await load()
        },
      },
    ])
  }

  const setDefault = async (item: Etablissement) => {
    const result = await setDefaultEtablissement(userId, item.id)
    if (!result.ok) {
      Alert.alert('Erreur', getFriendlyGenericError())
      return
    }
    await load()
  }

  if (loading) {
    return (
      <View style={s.loadWrap}>
        <Text style={s.loadTxt}>Chargement...</Text>
      </View>
    )
  }

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={s.backTxt}>Retour</Text>
        </TouchableOpacity>

        <Text style={s.title}>Mes établissements</Text>
        <Text style={s.sub}>Ajoutez plusieurs restos et choisissez lequel est principal.</Text>

        <View style={s.formCard}>
          <Text style={s.sectionTitle}>{draft.id ? 'Modifier un établissement' : 'Ajouter un établissement'}</Text>

          <Text style={s.label}>Nom *</Text>
          <TextInput
            style={s.input}
            value={draft.nom}
            onChangeText={(value) => setDraft((prev) => ({ ...prev, nom: value }))}
            placeholder="Ex : Restaurant A"
            placeholderTextColor="#9A9388"
          />

          <Text style={s.label}>Adresse</Text>
          <TextInput
            style={s.input}
            value={draft.adresse}
            onChangeText={(value) => setDraft((prev) => ({ ...prev, adresse: value }))}
            placeholder="12 rue de la République"
            placeholderTextColor="#9A9388"
          />

          <Text style={s.label}>Code postal *</Text>
          <TextInput
            style={s.input}
            value={draft.code_postal}
            onChangeText={(value) => setDraft((prev) => ({ ...prev, code_postal: value.replace(/\D/g, '') }))}
            placeholder="13001"
            placeholderTextColor="#9A9388"
            keyboardType="number-pad"
            maxLength={5}
          />

          <Text style={s.label}>Ville *</Text>
          <View style={[s.input, s.cityField]}>
            <Text style={draft.ville ? s.cityFieldText : s.cityFieldPlaceholder}>
              {draft.ville || 'Sélectionnez une ville'}
            </Text>
          </View>

          {draft.code_postal.length === 5 && (
            <View style={s.cityList}>
              {citiesLoading ? (
                <Text style={s.helper}>Recherche des villes...</Text>
              ) : cityOptions.length === 0 ? (
                <Text style={s.helper}>Aucune ville trouvée pour ce code postal</Text>
              ) : (
                cityOptions.map((city) => {
                  const selected = draft.ville === city.nom && draft.code_postal === city.codePostal
                  return (
                    <TouchableOpacity
                      key={`${city.codePostal}-${city.nom}`}
                      style={[s.cityOption, selected && s.cityOptionSelected]}
                      onPress={() => selectCity(city)}
                      activeOpacity={0.84}
                    >
                      <Text style={[s.cityOptionTxt, selected && s.cityOptionTxtSelected]}>{city.nom}</Text>
                    </TouchableOpacity>
                  )
                })
              )}
            </View>
          )}

          <View style={s.formActions}>
            {draft.id ? (
              <TouchableOpacity style={s.cancelBtn} onPress={resetDraft} activeOpacity={0.84}>
                <Text style={s.cancelBtnTxt}>Annuler</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity style={[s.saveBtn, saving && s.saveBtnDisabled]} onPress={saveEtablissement} disabled={saving} activeOpacity={0.88}>
              <Text style={s.saveBtnTxt}>{saving ? 'Enregistrement...' : draft.id ? 'Mettre à jour' : 'Ajouter'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.listWrap}>
          {etablissements.map((item) => (
            <View key={item.id} style={s.etabCard}>
              <View style={s.etabTop}>
                <View style={{ flex: 1 }}>
                  <Text style={s.etabName}>{item.nom}</Text>
                  {item.adresse ? <Text style={s.etabAddress}>{item.adresse}</Text> : null}
                  <Text style={s.etabMeta}>{item.ville}</Text>
                </View>
                {item.is_default ? (
                  <View style={s.defaultBadge}>
                    <Text style={s.defaultBadgeTxt}>Principal</Text>
                  </View>
                ) : null}
              </View>

              <View style={s.cardActions}>
                {!item.is_default ? (
                  <TouchableOpacity style={s.secondaryBtn} onPress={() => setDefault(item)} activeOpacity={0.84}>
                    <Text style={s.secondaryBtnTxt}>Définir comme principal</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={s.secondaryBtn} onPress={() => editEtablissement(item)} activeOpacity={0.84}>
                  <Text style={s.secondaryBtnTxt}>Modifier</Text>
                </TouchableOpacity>
                {etablissements.length > 1 ? (
                  <TouchableOpacity style={s.deleteBtn} onPress={() => deleteEtablissement(item)} activeOpacity={0.84}>
                    <Text style={s.deleteBtnTxt}>Supprimer</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 40 },
  loadWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  loadTxt: { color: C.textMuted },
  backBtn: { alignSelf: 'flex-start', marginBottom: 18 },
  backTxt: { fontSize: 15, color: C.terra, fontWeight: '700' },
  title: { fontSize: 30, fontWeight: '800', color: C.title, marginBottom: 8, letterSpacing: -0.5 },
  sub: { fontSize: 14, color: C.textSoft, lineHeight: 20, marginBottom: 18 },
  formCard: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 18 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: C.title, marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '700', color: C.title, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, color: C.title, backgroundColor: '#FFFCF8', marginBottom: 16 },
  cityField: { justifyContent: 'center' },
  cityFieldText: { fontSize: 15, color: C.title, fontWeight: '600' },
  cityFieldPlaceholder: { fontSize: 15, color: C.textMuted },
  cityList: { marginTop: -6, marginBottom: 16, gap: 8 },
  helper: { fontSize: 13, color: C.textMuted, lineHeight: 18 },
  cityOption: { backgroundColor: '#FFFCF8', borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  cityOptionSelected: { backgroundColor: C.terraBg, borderColor: C.terraBd },
  cityOptionTxt: { fontSize: 14, color: C.title, fontWeight: '600' },
  cityOptionTxtSelected: { color: C.terra },
  formActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingVertical: 14, alignItems: 'center', backgroundColor: '#FFFDFC' },
  cancelBtnTxt: { color: C.textSoft, fontWeight: '700' },
  saveBtn: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', backgroundColor: C.terra },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnTxt: { color: '#FFFFFF', fontWeight: '800' },
  listWrap: { gap: 10 },
  etabCard: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 16 },
  etabTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  etabName: { fontSize: 16, fontWeight: '800', color: C.title, marginBottom: 4 },
  etabAddress: { fontSize: 12, color: C.textMuted, marginBottom: 4 },
  etabMeta: { fontSize: 13, color: C.textSoft },
  defaultBadge: { backgroundColor: C.greenBg, borderColor: C.greenBd, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  defaultBadgeTxt: { fontSize: 11, fontWeight: '700', color: C.green },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  secondaryBtn: { borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FFFDFC' },
  secondaryBtnTxt: { fontSize: 12, fontWeight: '700', color: C.textSoft },
  deleteBtn: { borderRadius: 12, borderWidth: 1, borderColor: C.redBd, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.redBg },
  deleteBtnTxt: { fontSize: 12, fontWeight: '700', color: C.red },
})
