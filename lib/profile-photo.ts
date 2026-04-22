import * as ImageManipulator from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'

import { supabase } from './supabase'

export const PROFILE_PHOTO_BUCKET = 'profile-photos'
const PROFILE_PHOTO_MAX_SIZE = 900

export type ProfilePhotoRole = 'patron' | 'serveur'
export type ProfilePhotoSource = 'camera' | 'library'

type PickedProfilePhoto = {
  contentType: string
  uri: string
}

type UploadProfilePhotoParams = {
  currentPhotoUrl?: string | null
  role: ProfilePhotoRole
  userId: string
}

async function ensureMediaLibraryPermission() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) {
    throw new Error('media_permission_denied')
  }
}

async function ensureCameraPermission() {
  const permission = await ImagePicker.requestCameraPermissionsAsync()
  if (!permission.granted) {
    throw new Error('camera_permission_denied')
  }
}

async function pickImage(source: ProfilePhotoSource) {
  if (source === 'camera') {
    await ensureCameraPermission()
    return ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    })
  }

  await ensureMediaLibraryPermission()
  return ImagePicker.launchImageLibraryAsync({
    allowsEditing: true,
    aspect: [1, 1],
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.9,
  })
}

async function preparePhotoForUpload(uri: string): Promise<PickedProfilePhoto> {
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: PROFILE_PHOTO_MAX_SIZE } }],
    {
      compress: 0.78,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  )

  return {
    contentType: 'image/jpeg',
    uri: manipulated.uri,
  }
}

async function uriToArrayBuffer(uri: string) {
  const response = await fetch(uri)
  return response.arrayBuffer()
}

function getPublicUrlForPath(path: string) {
  const publicUrl = supabase.storage.from(PROFILE_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
  if (!publicUrl || !publicUrl.includes(`/${PROFILE_PHOTO_BUCKET}/`)) {
    throw new Error('storage_public_url_invalid')
  }
  return publicUrl
}

function extractStoragePathFromPublicUrl(photoUrl?: string | null) {
  if (!photoUrl) return null

  try {
    const url = new URL(photoUrl)
    const marker = `/storage/v1/object/public/${PROFILE_PHOTO_BUCKET}/`
    const markerIndex = url.pathname.indexOf(marker)
    if (markerIndex === -1) return null
    return decodeURIComponent(url.pathname.slice(markerIndex + marker.length))
  } catch {
    return null
  }
}

async function deleteStoredPhoto(photoUrl?: string | null) {
  const path = extractStoragePathFromPublicUrl(photoUrl)
  if (!path) return

  const { error } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).remove([path])
  if (error) {
    console.error('profile-photo delete error', error)
  }
}

export function getProfilePhotoErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : ''

  if (code === 'camera_permission_denied') {
    return "L'accès à la caméra est nécessaire pour prendre une photo."
  }

  if (code === 'media_permission_denied') {
    return "L'accès à la galerie est nécessaire pour choisir une photo."
  }

  if (code === 'storage_public_url_invalid') {
    return "La photo a été envoyée, mais l'URL publique est invalide."
  }

  return "Impossible de mettre à jour la photo de profil pour le moment."
}

export async function pickProfilePhoto(source: ProfilePhotoSource) {
  const result = await pickImage(source)
  if (result.canceled || !result.assets?.[0]?.uri) {
    return null
  }

  return preparePhotoForUpload(result.assets[0].uri)
}

export async function uploadProfilePhoto({
  currentPhotoUrl,
  photo,
  role,
  userId,
}: UploadProfilePhotoParams & { photo: PickedProfilePhoto }) {
  const path = `${role}s/${userId}/${Date.now()}.jpg`
  const body = await uriToArrayBuffer(photo.uri)
  const { error } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).upload(path, body, {
    contentType: photo.contentType,
    cacheControl: '3600',
    upsert: false,
  })

  if (error) {
    throw error
  }

  const publicUrl = getPublicUrlForPath(path)
  await deleteStoredPhoto(currentPhotoUrl)
  return publicUrl
}

export async function saveProfilePhotoUrl(
  role: ProfilePhotoRole,
  userId: string,
  photoUrl: string | null
) {
  const table = role === 'patron' ? 'patrons' : 'serveurs'
  const { data, error } = await supabase
    .from(table)
    .update({ photo_url: photoUrl })
    .eq('id', userId)
    .select('photo_url')
    .single()

  if (error) {
    throw error
  }

  if ((data?.photo_url ?? null) !== photoUrl) {
    throw new Error('profile_photo_url_not_saved')
  }
}

export async function removeProfilePhoto(
  role: ProfilePhotoRole,
  userId: string,
  currentPhotoUrl?: string | null
) {
  await deleteStoredPhoto(currentPhotoUrl)
  await saveProfilePhotoUrl(role, userId, null)
}
