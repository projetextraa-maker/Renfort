export type FrenchCityOption = {
  nom: string
  codePostal: string
  lat: number | null
  lng: number | null
}

function normalizeFrenchCityOptions(data: any[], fallbackPostalCode = ''): FrenchCityOption[] {
  return data
    .map((item: any) => ({
      nom: String(item.nom ?? ''),
      codePostal:
        Array.isArray(item.codesPostaux) && item.codesPostaux.length > 0
          ? String(item.codesPostaux[0])
          : fallbackPostalCode,
      lat: Array.isArray(item.centre?.coordinates) ? Number(item.centre.coordinates[1]) : null,
      lng: Array.isArray(item.centre?.coordinates) ? Number(item.centre.coordinates[0]) : null,
    }))
    .filter((item) => item.nom && item.codePostal)
}

export async function fetchCitiesByPostalCode(postalCode: string): Promise<FrenchCityOption[]> {
  try {
    const response = await fetch(
      `https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(postalCode)}&fields=nom,centre,codesPostaux&format=json`
    )

    if (!response.ok) return []

    const data = await response.json()
    if (!Array.isArray(data)) return []

    return normalizeFrenchCityOptions(data, postalCode)
  } catch {
    return []
  }
}

export async function searchFrenchCities(query: string): Promise<FrenchCityOption[]> {
  const normalizedQuery = query.trim()
  if (normalizedQuery.length < 2) return []

  if (/^\d{2,5}$/.test(normalizedQuery)) {
    if (normalizedQuery.length !== 5) return []
    return fetchCitiesByPostalCode(normalizedQuery)
  }

  try {
    const response = await fetch(
      `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(normalizedQuery)}&fields=nom,centre,codesPostaux&boost=population&limit=8&format=json`
    )

    if (!response.ok) return []

    const data = await response.json()
    if (!Array.isArray(data)) return []

    return normalizeFrenchCityOptions(data)
  } catch {
    return []
  }
}
