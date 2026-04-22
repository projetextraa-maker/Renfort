export type SupabaseErrorKind =
  | 'network'
  | 'auth'
  | 'rls'
  | 'schema'
  | 'not_found'
  | 'unknown'

export type SupabaseErrorDiagnostic = {
  kind: SupabaseErrorKind
  message: string
}

function getErrorText(error: unknown): string {
  return String((error as { message?: string } | null)?.message ?? error ?? '')
}

export function diagnoseSupabaseError(error: unknown): SupabaseErrorDiagnostic {
  const message = getErrorText(error)
  const lower = message.toLowerCase()

  if (
    lower.includes('upstream connect error') ||
    lower.includes('connection timeout') ||
    lower.includes('failed to fetch') ||
    lower.includes('network request failed') ||
    lower.includes('fetch failed') ||
    lower.includes('timeout')
  ) {
    return {
      kind: 'network',
      message: 'Connexion impossible au service pour le moment. Verifiez la connexion reseau puis reessayez.',
    }
  }

  if (
    lower.includes('jwt') ||
    lower.includes('auth session missing') ||
    lower.includes('invalid login credentials') ||
    lower.includes('not authenticated')
  ) {
    return {
      kind: 'auth',
      message: 'Votre session a expire. Reconnectez-vous puis reessayez.',
    }
  }

  if (
    lower.includes('row-level security') ||
    lower.includes('permission denied') ||
    lower.includes('new row violates row-level security')
  ) {
    return {
      kind: 'rls',
      message: "L'action est refusee par les regles d'acces Supabase.",
    }
  }

  if (
    lower.includes('schema cache') ||
    lower.includes('does not exist') ||
    lower.includes('could not find the table') ||
    lower.includes('relation "') ||
    lower.includes('column ') && lower.includes('does not exist')
  ) {
    return {
      kind: 'schema',
      message: 'La structure SQL attendue par cette action n est pas completement disponible.',
    }
  }

  if (lower.includes('no rows') || lower.includes('not found')) {
    return {
      kind: 'not_found',
      message: 'La ressource demandee est introuvable.',
    }
  }

  return {
    kind: 'unknown',
    message: 'Une erreur inattendue est survenue lors de la communication avec Supabase.',
  }
}

export function getFriendlySignupError(error: unknown): string {
  const message = getErrorText(error)
  const lower = message.toLowerCase()
  const diagnostic = diagnoseSupabaseError(error)

  if (lower.includes('user already registered') || lower.includes('already registered')) {
    return 'Un compte existe deja avec cette adresse email.'
  }

  if (lower.includes('password should be at least') || lower.includes('password')) {
    return 'Le mot de passe est trop faible. Choisissez au moins 6 caracteres.'
  }

  if (diagnostic.kind === 'network') return diagnostic.message

  return 'Impossible de creer le compte pour le moment.'
}

export function getFriendlyWriteError(
  error: unknown,
  fallback = 'Une erreur est survenue.'
): string {
  const diagnostic = diagnoseSupabaseError(error)

  if (diagnostic.kind === 'network') return diagnostic.message
  if (diagnostic.kind === 'rls') return "L'action est refusee pour le moment."
  if (diagnostic.kind === 'schema') return 'La configuration necessaire a cette action est incomplete.'

  return fallback
}
