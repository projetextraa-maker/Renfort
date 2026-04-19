import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { Platform } from 'react-native'

const supabaseUrl = 'https://zrkzgmyucsgboaztpped.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpya3pnbXl1Y3NnYm9henRwcGVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MzA4MjMsImV4cCI6MjA5MTMwNjgyM30.clK_Gr3e-hOmlEj-Q9tY2NFdJrzsOweW1vsF9df9er0'
if (!supabaseUrl) {
  throw new Error('Supabase URL manquante')
}

if (!supabaseAnonKey) {
  throw new Error('Supabase anon key manquante')
}

const isWeb = Platform.OS === 'web'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: isWeb ? undefined : AsyncStorage,
    autoRefreshToken: !isWeb,
    persistSession: true,
    detectSessionInUrl: isWeb,
  },
})