export type FrenchCityOption = {
  nom: string
  codePostal: string
  lat: number | null
  lng: number | null
}

export async function fetchCitiesByPostalCode(postalCode: string): Promise<FrenchCityOption[]> {
  try {
    const response = await fetch(
      `https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(postalCode)}&fields=nom,centre,codesPostaux&format=json`
    )

    if (!response.ok) return []

    const data = await response.json()
    if (!Array.isArray(data)) return []

    return data.map((item: any) => ({
      nom: String(item.nom ?? ''),
      codePostal:
        Array.isArray(item.codesPostaux) && item.codesPostaux.length > 0
          ? String(item.codesPostaux[0])
          : postalCode,
      lat: Array.isArray(item.centre?.coordinates) ? Number(item.centre.coordinates[1]) : null,
      lng: Array.isArray(item.centre?.coordinates) ? Number(item.centre.coordinates[0]) : null,
    }))
  } catch {
    return []
  }
}
