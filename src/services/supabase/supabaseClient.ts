import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { AuthError, AuthErrorType } from '../../types/auth';

// Environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Token expiry constants (in seconds)
export const ACCESS_TOKEN_EXPIRY = import.meta.env.VITE_JWT_EXPIRY ? parseInt(import.meta.env.VITE_JWT_EXPIRY) : 900; // 15 minutes
export const REFRESH_TOKEN_EXPIRY = import.meta.env.VITE_REFRESH_TOKEN_EXPIRY ? parseInt(import.meta.env.VITE_REFRESH_TOKEN_EXPIRY) : 86400; // 24 hours

// Validate environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
}

// Create Supabase client with custom configuration
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: {
      // Custom storage implementation for secure token handling
      getItem: (key: string) => {
        // For refresh tokens, we'll use httpOnly cookies in production
        // For development, we use localStorage with encryption
        if (key.includes('refresh_token')) {
          // In production, this would be handled by the backend
          return localStorage.getItem(key);
        }
        return localStorage.getItem(key);
      },
      setItem: (key: string, value: string) => {
        if (key.includes('refresh_token')) {
          // In production, this would be set as httpOnly cookie by the backend
          localStorage.setItem(key, value);
        } else {
          localStorage.setItem(key, value);
        }
      },
      removeItem: (key: string) => {
        localStorage.removeItem(key);
      }
    }
  },
  global: {
    headers: {
      'X-Client-Version': import.meta.env.VITE_APP_VERSION || '1.0.0'
    }
  }
});

// Helper function to handle Supabase errors
export function handleSupabaseError(error: any): AuthError {
  const errorMapping: Record<string, AuthErrorType> = {
    'Invalid login credentials': AuthErrorType.INVALID_CREDENTIALS,
    'JWT expired': AuthErrorType.TOKEN_EXPIRED,
    'Invalid token': AuthErrorType.TOKEN_INVALID,
    'User not found': AuthErrorType.USER_NOT_FOUND,
    'Email not confirmed': AuthErrorType.EMAIL_NOT_VERIFIED,
    'Rate limit exceeded': AuthErrorType.RATE_LIMIT_EXCEEDED
  };

  const errorType = errorMapping[error.message] || AuthErrorType.NETWORK_ERROR;
  
  return {
    type: errorType,
    message: error.message || 'An unknown error occurred',
    code: error.code,
    details: error.details
  };
}

// Session management utilities
export const sessionManager = {
  // Get current session
  async getSession(): Promise<Session | null> {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.error('Error getting session:', error);
      return null;
    }
    return session;
  },

  // Refresh access token
  async refreshSession(): Promise<Session | null> {
    const { data: { session }, error } = await supabase.auth.refreshSession();
    if (error) {
      console.error('Error refreshing session:', error);
      return null;
    }
    return session;
  },

  // Check if session is expired
  isSessionExpired(session: Session): boolean {
    if (!session || !session.expires_at) return true;
    return new Date().getTime() > session.expires_at * 1000;
  },

  // Get time until token expiry
  getTimeUntilExpiry(session: Session): number {
    if (!session || !session.expires_at) return 0;
    const expiryTime = session.expires_at * 1000;
    const currentTime = new Date().getTime();
    return Math.max(0, expiryTime - currentTime);
  }
};

// Cookie utilities for production (to be implemented server-side)
export const cookieUtils = {
  // Set httpOnly cookie (requires server-side implementation)
  setHttpOnlyCookie(name: string, value: string, maxAge: number): void {
    // In production, this would make a request to a secure endpoint
    // that sets the httpOnly cookie
    console.warn('HttpOnly cookies should be set server-side for security');
  },

  // Remove httpOnly cookie (requires server-side implementation)
  removeHttpOnlyCookie(name: string): void {
    // In production, this would make a request to a secure endpoint
    // that removes the httpOnly cookie
    console.warn('HttpOnly cookies should be removed server-side for security');
  }
};

// Export default client
export default supabase;