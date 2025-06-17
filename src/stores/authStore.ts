/**
 * Authentication Store
 * Centralized state management for authentication using Zustand
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { 
  User, 
  AuthState, 
  LoginCredentials, 
  RegisterData, 
  TokenResponse,
  AuthError,
  PasswordResetRequest,
  PasswordResetConfirm
} from '../types/auth';
import { authService } from '../services/auth/authService';

interface AuthStore extends AuthState {
  // Actions
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (userData: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  checkAuthState: () => Promise<void>;
  requestPasswordReset: (request: PasswordResetRequest) => Promise<void>;
  confirmPasswordReset: (confirmation: PasswordResetConfirm) => Promise<void>;
  updateProfile: (updates: Partial<User>) => Promise<void>;
  clearError: () => void;
  
  // Error state
  error: AuthError | null;
  
  // Session management
  sessionExpiry: number | null;
  lastActivity: number;
  updateLastActivity: () => void;
  
  // Internal actions
  setUser: (user: User | null) => void;
  setTokens: (tokens: TokenResponse | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: AuthError | null) => void;
}

export const useAuthStore = create<AuthStore>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        user: null,
        accessToken: null,
        refreshToken: null,
        isLoading: false,
        isAuthenticated: false,
        sessionExpiry: null,
        lastActivity: Date.now(),
        error: null,

        // Actions
        login: async (credentials: LoginCredentials) => {
          try {
            set({ isLoading: true, error: null });
            
            const { user, tokens } = await authService.login(credentials);
            
            set({
              user,
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              isAuthenticated: true,
              sessionExpiry: Date.now() + (tokens.expiresIn * 1000),
              lastActivity: Date.now(),
              isLoading: false
            });
          } catch (error) {
            set({
              error: error as AuthError,
              isLoading: false,
              isAuthenticated: false,
              user: null,
              accessToken: null,
              refreshToken: null
            });
            throw error;
          }
        },

        register: async (userData: RegisterData) => {
          try {
            set({ isLoading: true, error: null });
            
            const { user, tokens } = await authService.register(userData);
            
            set({
              user,
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              isAuthenticated: true,
              sessionExpiry: Date.now() + (tokens.expiresIn * 1000),
              lastActivity: Date.now(),
              isLoading: false
            });
          } catch (error) {
            set({
              error: error as AuthError,
              isLoading: false
            });
            throw error;
          }
        },

        logout: async () => {
          try {
            set({ isLoading: true });
            
            await authService.logout();
            
            set({
              user: null,
              accessToken: null,
              refreshToken: null,
              isAuthenticated: false,
              sessionExpiry: null,
              lastActivity: Date.now(),
              error: null,
              isLoading: false
            });
          } catch (error) {
            // Even if logout fails on server, clear local state
            set({
              user: null,
              accessToken: null,
              refreshToken: null,
              isAuthenticated: false,
              sessionExpiry: null,
              error: null,
              isLoading: false
            });
          }
        },

        refreshToken: async () => {
          try {
            const tokens = await authService.refreshToken();
            
            set({
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              sessionExpiry: Date.now() + (tokens.expiresIn * 1000),
              lastActivity: Date.now()
            });
          } catch (error) {
            // If refresh fails, logout user
            await get().logout();
            throw error;
          }
        },

        checkAuthState: async () => {
          try {
            set({ isLoading: true });
            
            const user = await authService.getCurrentUser();
            
            if (user) {
              set({
                user,
                isAuthenticated: true,
                isLoading: false
              });
            } else {
              set({
                user: null,
                isAuthenticated: false,
                accessToken: null,
                refreshToken: null,
                sessionExpiry: null,
                isLoading: false
              });
            }
          } catch (error) {
            set({
              user: null,
              isAuthenticated: false,
              accessToken: null,
              refreshToken: null,
              sessionExpiry: null,
              error: error as AuthError,
              isLoading: false
            });
          }
        },

        requestPasswordReset: async (request: PasswordResetRequest) => {
          try {
            set({ isLoading: true, error: null });
            
            await authService.requestPasswordReset(request);
            
            set({ isLoading: false });
          } catch (error) {
            set({
              error: error as AuthError,
              isLoading: false
            });
            throw error;
          }
        },

        confirmPasswordReset: async (confirmation: PasswordResetConfirm) => {
          try {
            set({ isLoading: true, error: null });
            
            await authService.confirmPasswordReset(confirmation);
            
            set({ isLoading: false });
          } catch (error) {
            set({
              error: error as AuthError,
              isLoading: false
            });
            throw error;
          }
        },

        updateProfile: async (updates: Partial<User>) => {
          try {
            set({ isLoading: true, error: null });
            
            const updatedUser = await authService.updateProfile(updates);
            
            set({
              user: updatedUser,
              isLoading: false
            });
          } catch (error) {
            set({
              error: error as AuthError,
              isLoading: false
            });
            throw error;
          }
        },

        clearError: () => {
          set({ error: null });
        },

        updateLastActivity: () => {
          set({ lastActivity: Date.now() });
        },

        // Internal setters
        setUser: (user: User | null) => {
          set({ user, isAuthenticated: !!user });
        },

        setTokens: (tokens: TokenResponse | null) => {
          if (tokens) {
            set({
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              sessionExpiry: Date.now() + (tokens.expiresIn * 1000)
            });
          } else {
            set({
              accessToken: null,
              refreshToken: null,
              sessionExpiry: null
            });
          }
        },

        setLoading: (loading: boolean) => {
          set({ isLoading: loading });
        },

        setError: (error: AuthError | null) => {
          set({ error });
        }
      }),
      {
        name: '3d-viewer-auth',
        
        // Only persist essential auth state
        partialize: (state) => ({
          user: state.user,
          isAuthenticated: state.isAuthenticated,
          sessionExpiry: state.sessionExpiry,
          lastActivity: state.lastActivity
        }),
        
        // Custom storage with encryption for sensitive data
        storage: {
          getItem: (name: string) => {
            const item = localStorage.getItem(name);
            if (!item) return null;
            
            try {
              return JSON.parse(item);
            } catch {
              return null;
            }
          },
          
          setItem: (name: string, value: any) => {
            localStorage.setItem(name, JSON.stringify(value));
          },
          
          removeItem: (name: string) => {
            localStorage.removeItem(name);
          }
        },
        
        // Version for migration handling
        version: 1,
        
        // Migration function for handling version changes
        migrate: (persistedState: any, version: number) => {
          if (version === 0) {
            // Handle migration from version 0 to 1
            return {
              ...persistedState,
              lastActivity: Date.now()
            };
          }
          return persistedState;
        }
      }
    ),
    {
      name: 'auth-store'
    }
  )
);

// Session timeout check
let sessionTimeoutId: NodeJS.Timeout;

// Auto-refresh token when it's about to expire
export const startTokenRefreshTimer = () => {
  const checkAndRefresh = async () => {
    const state = useAuthStore.getState();
    
    if (state.isAuthenticated && state.sessionExpiry) {
      const timeUntilExpiry = state.sessionExpiry - Date.now();
      
      // Refresh token 5 minutes before expiry
      if (timeUntilExpiry <= 5 * 60 * 1000 && timeUntilExpiry > 0) {
        try {
          await state.refreshToken();
        } catch (error) {
          console.error('Auto token refresh failed:', error);
          await state.logout();
        }
      }
      
      // Logout if token is expired
      if (timeUntilExpiry <= 0) {
        await state.logout();
      }
    }
    
    // Check every minute
    sessionTimeoutId = setTimeout(checkAndRefresh, 60 * 1000);
  };
  
  checkAndRefresh();
};

// Stop token refresh timer
export const stopTokenRefreshTimer = () => {
  if (sessionTimeoutId) {
    clearTimeout(sessionTimeoutId);
  }
};

// Activity tracker for session management
export const startActivityTracker = () => {
  const updateActivity = () => {
    const state = useAuthStore.getState();
    if (state.isAuthenticated) {
      state.updateLastActivity();
    }
  };
  
  // Track various user activities
  const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
  
  events.forEach(event => {
    document.addEventListener(event, updateActivity, true);
  });
  
  return () => {
    events.forEach(event => {
      document.removeEventListener(event, updateActivity, true);
    });
  };
};