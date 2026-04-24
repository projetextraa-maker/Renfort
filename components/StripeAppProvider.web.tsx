import type { ReactNode } from 'react'

type StripeAppProviderProps = {
  children: ReactNode
  publishableKey: string
}

export default function StripeAppProvider({
  children,
}: StripeAppProviderProps) {
  return <>{children}</>
}
