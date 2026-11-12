import { useQueryClient } from '@tanstack/react-query'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import { supabaseClient } from './supabase'

interface AuthState {
  client: SupabaseClient | null
  session: Session | null
  ready: boolean
}

const AuthContext = createContext<AuthState>({ client: null, session: null, ready: false })

export const useAuth = () => useContext(AuthContext)

/** Creates the Supabase client once and keeps the signed-in session in state. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ client: null, session: null, ready: false })
  const queryClient = useQueryClient()

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    void supabaseClient().then(async (client) => {
      if (!active) return
      if (!client) {
        setState({ client: null, session: null, ready: true })
        return
      }
      const { data } = await client.auth.getSession()
      if (!active) return
      setState({ client, session: data.session, ready: true })
      const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
        setState({ client, session, ready: true })
        void queryClient.invalidateQueries({ queryKey: ['me'] })
      })
      unsubscribe = () => listener.subscription.unsubscribe()
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [queryClient])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}
