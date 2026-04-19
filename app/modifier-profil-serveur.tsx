import Slider from '@react-native-community/slider'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { fetchCitiesByPostalCode, type FrenchCityOption } from '../lib/french-postal'
import {
  EXPERIENCE_DESCRIPTIONS_SUGGESTIONS,
  EXPERIENCE_DUREES,
  EXPERIENCE_POSTES,
  formatServeurExperience,
  type ServeurExperience,
} from '../lib/serveur-experiences'
import { fetchServeurExperiences, replaceServeurExperiences } from '../lib/serveur-experiences-api'
import { supabase } from '../lib/supabase'

export default function ModifierProfilServeur() {
  const router = useRouter()
  const [prenom,     setPrenom]     = useState('')
  const [nom,        setNom]        = useState('')
  const [telephone,  setTelephone]  = useState('')
  const [photoUrl,   setPhotoUrl]   = useState('')
  const [description, setDescription] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [ville,      setVille]      = useState('')
  const [experiences, setExperiences] = useState<ServeurExperience[]>([])
  const [rayon,      setRayon]      = useState(20)
  const [loading,    setLoading]    = useState(false)
  const [serveurId,  setServeurId]  = useState('')
  const [citiesLoading, setCitiesLoading] = useState(false)
  const [cityOptions,   setCityOptions]   = useState<FrenchCityOption[]>([])
  const [selectedCity,  setSelectedCity]  = useState<FrenchCityOption | null>(null)
  const [editingExperienceIndex, setEditingExperienceIndex] = useState<number | null>(null)
  const [showExperienceEditor,   setShowExperienceEditor]   = useState(false)
  const [draftExperience, setDraftExperience] = useState<ServeurExperience>({
    poste: '', description: '', duree: '',
  })

  useEffect(() => { void chargerProfil() }, [])

  useEffect(() => {
    let cancelled = false
    const loadCities = async () => {
      if (postalCode.length !== 5) { setCityOptions([]); setCitiesLoading(false); return }
      setCitiesLoading(true)
      const nextCities = await fetchCitiesByPostalCode(postalCode)
      if (cancelled) return
      setCityOptions(nextCities)
      setCitiesLoading(false)
      const matchingSelected = nextCities.find(
        (item) => item.nom === selectedCity?.nom && item.codePostal === selectedCity?.codePostal
      )
      if (!matchingSelected && ville) {
        const matchingFromValue = nextCities.find((item) => item.nom === ville)
        setSelectedCity(matchingFromValue ?? null)
      }
    }
    void loadCities()
    return () => { cancelled = true }
  }, [postalCode, selectedCity?.codePostal, selectedCity?.nom, ville])

  const chargerProfil = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data, error } = await supabase.from('serveurs').select('*').eq('id', user.id).single()
    if (!error && data) {
      setServeurId(data.id)
      setPrenom(data.prenom || '')
      setNom(data.nom || '')
      setTelephone(data.telephone || '')
      setPhotoUrl(data.photo_url || '')
      setDescription(data.description || '')
      setPostalCode(data.code_postal || '')
      setVille(data.ville || '')
      setRayon(data.rayon || 20)
      const nextExperiences = await fetchServeurExperiences(data.id)
      setExperiences(nextExperiences)
      if (data.ville || data.code_postal) {
        setSelectedCity({
          nom: data.ville || '',
          codePostal: data.code_postal || '',
          lat: data.lat ?? null,
          lng: data.lng ?? null,
        })
      }
    }
  }

  const handleSelectCity = (city: FrenchCityOption) => {
    setSelectedCity(city); setVille(city.nom); setPostalCode(city.codePostal)
  }

  const resetDraftExperience = () => {
    setDraftExperience({ poste: '', description: '', duree: '' })
    setEditingExperienceIndex(null)
    setShowExperienceEditor(false)
  }

  const startAddExperience = () => {
    setDraftExperience({ poste: '', description: '', duree: '' })
    setEditingExperienceIndex(null)
    setShowExperienceEditor(true)
  }

  const startEditExperience = (index: number) => {
    const current = experiences[index]
    if (!current) return
    setDraftExperience({ id: current.id, poste: current.poste, description: current.description, duree: current.duree })
    setEditingExperienceIndex(index)
    setShowExperienceEditor(true)
  }

  const removeExperience = (index: number) => {
    setExperiences((prev) => prev.filter((_, i) => i !== index))
    if (editingExperienceIndex === index) resetDraftExperience()
  }

  const updateDraftExperience = (field: keyof ServeurExperience, value: string) => {
    setDraftExperience((prev) => ({ ...prev, [field]: value }))
  }

  const saveDraftExperience = () => {
    if (!draftExperience.poste || !draftExperience.duree || !draftExperience.description.trim()) {
      Alert.alert('Erreur', 'Choisissez un poste, une duree et ajoutez une precision courte.')
      return
    }
    const nextValue: ServeurExperience = {
      id: editingExperienceIndex != null ? experiences[editingExperienceIndex]?.id : undefined,
      poste: draftExperience.poste,
      description: draftExperience.description.trim(),
      duree: draftExperience.duree,
    }
    if (editingExperienceIndex == null) {
      setExperiences((prev) => [...prev, nextValue])
    } else {
      setExperiences((prev) => prev.map((item, index) => (index === editingExperienceIndex ? nextValue : item)))
    }
    resetDraftExperience()
  }

  const handleSauvegarder = async () => {
    if (!prenom || !nom || !telephone || !postalCode || !ville || !selectedCity) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs obligatoires')
      return
    }
    setLoading(true)

    // Save profile info only — never touch disponible or calendar slots
    const { error } = await supabase.from('serveurs').update({
      prenom, nom, telephone,
      photo_url: photoUrl.trim() || null,
      description: description.trim() || null,
      code_postal: postalCode,
      ville,
      lat: selectedCity.lat,
      lng: selectedCity.lng,
      rayon,
    }).eq('id', serveurId)

    if (error) { setLoading(false); Alert.alert('Erreur', error.message); return }

    const experiencesResult = await replaceServeurExperiences(serveurId, experiences)
    setLoading(false)
    if (!experiencesResult.ok) {
      Alert.alert('Erreur', experiencesResult.error ?? "Impossible d'enregistrer les experiences.")
      return
    }
    Alert.alert('Succes', 'Profil mis a jour !', [{ text: 'OK', onPress: () => router.back() }])
  }

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>Retour</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Modifier mon profil</Text>
      <Text style={styles.subtitle}>Mettez a jour vos informations</Text>

      <Text style={styles.label}>Prenom *</Text>
      <TextInput style={styles.input} value={prenom} onChangeText={setPrenom} placeholder="Votre prenom" placeholderTextColor="#999" />

      <Text style={styles.label}>Nom *</Text>
      <TextInput style={styles.input} value={nom} onChangeText={setNom} placeholder="Votre nom" placeholderTextColor="#999" />

      <Text style={styles.label}>Telephone *</Text>
      <TextInput style={styles.input} value={telephone} onChangeText={setTelephone} placeholder="06 00 00 00 00" placeholderTextColor="#999" keyboardType="phone-pad" />

      <Text style={styles.label}>Photo de profil</Text>
      {photoUrl.trim() ? (
        <View style={styles.photoPreviewWrap}>
          <Image source={{ uri: photoUrl.trim() }} style={styles.photoPreview} />
        </View>
      ) : (
        <View style={styles.photoPlaceholder}>
          <Text style={styles.photoPlaceholderText}>Ajoutez l&apos;URL d&apos;une photo pour rassurer les patrons</Text>
        </View>
      )}
      <TextInput
        style={styles.input}
        value={photoUrl}
        onChangeText={setPhotoUrl}
        placeholder="https://..."
        placeholderTextColor="#999"
        autoCapitalize="none"
      />

      <Text style={styles.label}>Description / mini presentation</Text>
      <TextInput
        style={[styles.input, styles.descriptionInput]}
        value={description}
        onChangeText={setDescription}
        placeholder="Ex : Extra souriante et ponctuelle, a l'aise en brasserie et en gros service."
        placeholderTextColor="#999"
        multiline
        maxLength={320}
        textAlignVertical="top"
      />
      <Text style={styles.descriptionHint}>
        Cette presentation sera visible par les patrons dans votre profil public.
      </Text>

      <Text style={styles.label}>Code postal *</Text>
      <TextInput
        style={styles.input}
        value={postalCode}
        onChangeText={(value) => setPostalCode(value.replace(/\D/g, ''))}
        placeholder="Ex : 83270"
        placeholderTextColor="#999"
        keyboardType="number-pad"
        maxLength={5}
      />

      <Text style={styles.label}>Ville *</Text>
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

      {/* EXPERIENCES */}
      <View style={styles.section}>
        <Text style={styles.label}>Experiences</Text>
        <Text style={styles.sectionHelper}>Ajoutez des experiences courtes et concretes pour rassurer les patrons.</Text>

        {experiences.length === 0 ? (
          <View style={styles.experienceEmpty}>
            <Text style={styles.experienceEmptyText}>Aucune experience structuree ajoutee pour le moment.</Text>
          </View>
        ) : (
          <View style={styles.experienceCardsList}>
            {experiences.map((item, index) => (
              <View key={`experience-${item.id ?? index}`} style={styles.experienceSummaryCard}>
                <View style={{ marginBottom: 10 }}>
                  <Text style={styles.experienceSummaryTitle}>{`${item.poste} - ${item.duree}`}</Text>
                  <Text style={styles.experienceSummarySubtitle}>{item.description}</Text>
                </View>
                <View style={styles.experienceSummaryActions}>
                  <TouchableOpacity style={[styles.smallActionBtn, styles.smallActionBtnGhost]} onPress={() => startEditExperience(index)}>
                    <Text style={styles.smallActionBtnGhostText}>Modifier</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.smallActionBtn, styles.smallActionBtnDanger]} onPress={() => removeExperience(index)}>
                    <Text style={styles.smallActionBtnDangerText}>Supprimer</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {showExperienceEditor ? (
          <>
            <View style={styles.experienceEditorCard}>
              <View style={styles.experienceEditorHeader}>
                <Text style={styles.experienceCardTitle}>
                  {editingExperienceIndex == null ? 'Nouvelle experience' : "Modifier l'experience"}
                </Text>
                <TouchableOpacity onPress={resetDraftExperience}>
                  <Text style={styles.resetButtonText}>Annuler</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.subLabel}>Poste</Text>
              <View style={styles.optionsWrap}>
                {EXPERIENCE_POSTES.map((poste) => {
                  const selected = draftExperience.poste === poste
                  return (
                    <TouchableOpacity key={`draft-${poste}`} style={[styles.optionChip, selected && styles.optionChipSelected]} onPress={() => updateDraftExperience('poste', poste)}>
                      <Text style={[styles.optionChipText, selected && styles.optionChipTextSelected]}>{poste}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>

              <Text style={styles.subLabel}>Description courte</Text>
              <TextInput
                style={[styles.input, styles.precisionInput]}
                value={draftExperience.description}
                onChangeText={(value) => updateDraftExperience('description', value)}
                placeholder="Ex : Brasserie, gros debit"
                placeholderTextColor="#999"
                maxLength={80}
              />

              <View style={styles.quickContextRow}>
                {EXPERIENCE_DESCRIPTIONS_SUGGESTIONS.map((description) => (
                  <TouchableOpacity key={`quick-${description}`} style={styles.quickContextChip} onPress={() => updateDraftExperience('description', description)}>
                    <Text style={styles.quickContextChipText}>{description}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.subLabel}>Duree</Text>
              <View style={styles.optionsWrap}>
                {EXPERIENCE_DUREES.map((duree) => {
                  const selected = draftExperience.duree === duree
                  return (
                    <TouchableOpacity key={`draft-${duree}`} style={[styles.optionChip, selected && styles.optionChipSelected]} onPress={() => updateDraftExperience('duree', duree)}>
                      <Text style={[styles.optionChipText, selected && styles.optionChipTextSelected]}>{duree}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>

              {draftExperience.poste && draftExperience.description && draftExperience.duree ? (
                <View style={styles.experiencePreview}>
                  <Text style={styles.experiencePreviewText}>{formatServeurExperience(draftExperience)}</Text>
                </View>
              ) : null}
            </View>

            <TouchableOpacity style={styles.addExperienceButton} onPress={saveDraftExperience}>
              <Text style={styles.addExperienceButtonText}>
                {editingExperienceIndex == null ? 'Ajouter une experience' : 'Enregistrer cette experience'}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.secondaryAddButton} onPress={startAddExperience}>
            <Text style={styles.secondaryAddButtonText}>Ajouter une experience</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* RAYON */}
      <View style={styles.rayonContainer}>
        <View style={styles.rayonHeader}>
          <Text style={styles.label}>Rayon de recherche</Text>
          <Text style={styles.rayonValeur}>{rayon} km</Text>
        </View>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={50}
          step={5}
          value={rayon}
          onValueChange={(val) => setRayon(val)}
          minimumTrackTintColor="#1D9E75"
          maximumTrackTintColor="#ddd"
          thumbTintColor="#1D9E75"
        />
        <View style={styles.rayonLabels}>
          <Text style={styles.rayonLabelMin}>0 km</Text>
          <Text style={styles.rayonLabelMax}>50 km</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleSauvegarder}
        disabled={loading}
      >
        <Text style={styles.buttonText}>{loading ? 'Sauvegarde...' : 'Sauvegarder'}</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#fff', padding: 20, paddingTop: 60 },
  back:        { marginBottom: 24 },
  backText:    { fontSize: 16, color: '#1D9E75' },
  title:       { fontSize: 26, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 6 },
  subtitle:    { fontSize: 14, color: '#666', marginBottom: 32 },
  label:       { fontSize: 14, fontWeight: '600', color: '#1a1a1a', marginBottom: 6 },
  input:       { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 14, fontSize: 15, color: '#1a1a1a', marginBottom: 20, backgroundColor: '#fff' },
  descriptionInput: { minHeight: 110 },
  descriptionHint:  { fontSize: 12, color: '#8A7B70', marginTop: -12, marginBottom: 20, lineHeight: 18 },
  photoPreviewWrap: { marginBottom: 12, alignItems: 'center' },
  photoPreview:     { width: 92, height: 92, borderRadius: 46, backgroundColor: '#F3E8DD', borderWidth: 2, borderColor: '#E7D3C2' },
  photoPlaceholder: { borderWidth: 1, borderColor: '#E8DED1', backgroundColor: '#F8F3EC', borderRadius: 12, padding: 14, marginBottom: 12 },
  photoPlaceholderText: { fontSize: 13, color: '#8A7B70', lineHeight: 18 },
  precisionInput: { height: 52, marginBottom: 14 },

  cityField:              { justifyContent: 'center' },
  cityFieldDisabled:      { backgroundColor: '#F6F1EB' },
  cityFieldText:          { fontSize: 15, color: '#1a1a1a', fontWeight: '600' },
  cityFieldPlaceholder:   { fontSize: 15, color: '#999' },
  cityOptionsWrap:        { marginTop: -8, marginBottom: 20, gap: 8 },
  cityHelper:             { fontSize: 13, color: '#999', lineHeight: 18 },
  cityOption:             { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 14 },
  cityOptionSelected:     { backgroundColor: '#FFF6ED', borderColor: '#F0C7A8' },
  cityOptionText:         { fontSize: 14, color: '#1a1a1a', fontWeight: '600' },
  cityOptionTextSelected: { color: '#C46A3C' },

  section:       { marginBottom: 24 },
  sectionHelper: { fontSize: 13, color: '#8A7B70', lineHeight: 18, marginBottom: 14 },

  experienceEmpty:           { backgroundColor: '#F8F3EC', borderWidth: 1, borderColor: '#E8DED1', borderRadius: 12, padding: 14, marginBottom: 12 },
  experienceEmptyText:       { fontSize: 13, color: '#8A7B70', lineHeight: 18 },
  experienceCardsList:       { gap: 10, marginBottom: 14 },
  experienceSummaryCard:     { backgroundColor: '#FFFDF9', borderWidth: 1, borderColor: '#E8DED1', borderRadius: 16, padding: 14 },
  experienceSummaryTitle:    { fontSize: 15, fontWeight: '800', color: '#1a1a1a', lineHeight: 20 },
  experienceSummarySubtitle: { fontSize: 13, color: '#6A5E54', lineHeight: 18, marginTop: 4 },
  experienceSummaryActions:  { flexDirection: 'row', gap: 8 },
  smallActionBtn:            { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1 },
  smallActionBtnGhost:       { backgroundColor: '#F8F3EC', borderColor: '#E8DED1' },
  smallActionBtnGhostText:   { fontSize: 12, fontWeight: '700', color: '#5F544B' },
  smallActionBtnDanger:      { backgroundColor: '#FEF1ED', borderColor: '#F1C8BA' },
  smallActionBtnDangerText:  { fontSize: 12, fontWeight: '700', color: '#B65B39' },
  experienceEditorCard:      { backgroundColor: '#FFFDF9', borderWidth: 1, borderColor: '#E8DED1', borderRadius: 16, padding: 14 },
  experienceEditorHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  experienceCardTitle:       { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  resetButtonText:           { fontSize: 13, fontWeight: '700', color: '#B65B39' },
  subLabel:                  { fontSize: 13, fontWeight: '700', color: '#3B312B', marginBottom: 8 },
  optionsWrap:               { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  optionChip:                { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DDD3C7', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  optionChipSelected:        { backgroundColor: '#FFF6ED', borderColor: '#F0C7A8' },
  optionChipText:            { fontSize: 13, color: '#5F544B', fontWeight: '600' },
  optionChipTextSelected:    { color: '#C46A3C' },
  quickContextRow:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  quickContextChip:          { backgroundColor: '#F7F2EB', borderWidth: 1, borderColor: '#E8DDD0', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  quickContextChipText:      { fontSize: 12, color: '#7A6A5D', fontWeight: '600' },
  experiencePreview:         { backgroundColor: '#F8F3EC', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  experiencePreviewText:     { fontSize: 13, color: '#3B312B', fontWeight: '600', lineHeight: 18 },
  addExperienceButton:       { backgroundColor: '#C46A3C', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 14 },
  addExperienceButtonText:   { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  secondaryAddButton:        { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: '#F0C7A8', backgroundColor: '#FFF6ED' },
  secondaryAddButtonText:    { fontSize: 14, fontWeight: '700', color: '#C46A3C' },

  rayonContainer: { marginBottom: 24 },
  rayonHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  rayonValeur:    { fontSize: 16, fontWeight: '600', color: '#1D9E75' },
  slider:         { width: '100%', height: 40 },
  rayonLabels:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  rayonLabelMin:  { fontSize: 12, color: '#999' },
  rayonLabelMax:  { fontSize: 12, color: '#999' },

  button:         { backgroundColor: '#1D9E75', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 8, marginBottom: 40 },
  buttonDisabled: { backgroundColor: '#ccc' },
  buttonText:     { color: '#fff', fontSize: 18, fontWeight: '600' },
})
