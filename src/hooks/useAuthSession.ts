import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  loadCurrentSession,
  login,
  loginWithEmailCode,
  logout,
  register,
  type AuthSession,
} from "../services/auth";

const authSessionQueryKey = ["auth-session"] as const;

export function useAuthSession() {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery<AuthSession | null>({
    queryKey: authSessionQueryKey,
    queryFn: loadCurrentSession,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const signIn = useCallback(async (email: string, password: string) => {
    const nextSession = await login({ email, password });
    queryClient.setQueryData(authSessionQueryKey, nextSession);
  }, [queryClient]);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const nextSession = await register({ email, password, displayName });
    queryClient.setQueryData(authSessionQueryKey, nextSession);
  }, [queryClient]);

  const signInWithEmailCode = useCallback(async (email: string, code: string) => {
    const nextSession = await loginWithEmailCode(email, code);
    queryClient.setQueryData(authSessionQueryKey, nextSession);
  }, [queryClient]);

  const updateSession = useCallback((nextSession: AuthSession) => {
    queryClient.setQueryData(authSessionQueryKey, nextSession);
  }, [queryClient]);

  const signOut = useCallback(() => {
    void logout();
    queryClient.setQueryData(authSessionQueryKey, null);
    queryClient.removeQueries({ queryKey: ["knowledge-base"] });
  }, [queryClient]);

  return {
    loading: sessionQuery.isLoading,
    session: sessionQuery.data ?? null,
    signIn,
    signInWithEmailCode,
    signUp,
    signOut,
    updateSession,
  };
}
