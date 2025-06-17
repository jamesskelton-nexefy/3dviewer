/**
 * Supabase Services Export
 * Central export point for all Supabase-related services
 */

// Core client and utilities
export { supabase, handleSupabaseError, sessionManager, cookieUtils } from './supabaseClient';
export type { default as SupabaseClient } from './supabaseClient';

// Authentication service
export { authService } from './authService';
export type { AuthService } from './authService';

// RBAC service
export { rbacService } from './rbacService';
export type { RBACService } from './rbacService';

// Sharing service
export { sharingService } from './sharingService';
export type { SharingService } from './sharingService';

// Session service
export { sessionService } from './sessionService';
export type { SessionService } from './sessionService';

// Constants
export { ACCESS_TOKEN_EXPIRY, REFRESH_TOKEN_EXPIRY } from './supabaseClient';

// Helper functions
export { createSupabaseMiddleware } from './middleware';

// Re-export commonly used types
export type {
  User,
  UserRole,
  Permission,
  AuthState,
  LoginCredentials,
  RegisterData,
  TokenResponse,
  JWTPayload,
  ShareLink,
  SessionInfo,
  AuthError,
  AuthErrorType
} from '../../types/auth';