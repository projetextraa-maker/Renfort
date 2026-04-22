import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { ensureAccountProfileForUser } from '../lib/auth-profile-sync'
import { getHomeRouteForRole, getLoginRouteForRole, getRequiredRoleForSegments, resolveAccountRole } from '../lib/auth-role'
import { enregistrerNotifications, shouldRetryPushRegistration } from '../lib/notifications'
import { supabase } from '../lib/supabase'

export default function RootLayout() {
  const router = useRouter()
  const segments = useSegments()

  useEffect(() => {
    let cancelled = false

    const registerPush = async () => {
      const shouldTry = await shouldRetryPushRegistration()
      const result = await enregistrerNotifications()

      if (cancelled) return

      if (!result.ok && shouldTry) {
        console.info('[notifications] enregistrement push reporte, nouvel essai au prochain lancement')
      }
    }

    registerPush()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const guardRoute = async () => {
      const requiredRole = getRequiredRoleForSegments(segments)
      if (!requiredRole) return

      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (cancelled) return

      if (!session?.user) {
        router.replace(getLoginRouteForRole(requiredRole))
        return
      }

      const profileSync = await ensureAccountProfileForUser(session.user)
      if (!profileSync.ok && profileSync.reason !== 'missing_role') {
        console.error('root layout profile sync error', profileSync)
      }

      const actualRole = await resolveAccountRole(
        session.user.id,
        session.user.user_metadata?.account_role
      )

      if (cancelled) return

      if (!actualRole) {
        await supabase.auth.signOut()
        if (!cancelled) router.replace('/')
        return
      }

      if (actualRole !== requiredRole) {
        router.replace(getHomeRouteForRole(actualRole))
      }
    }

    guardRoute()

    return () => {
      cancelled = true
    }
  }, [router, segments])

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="auto" />
    </>
  )
}
