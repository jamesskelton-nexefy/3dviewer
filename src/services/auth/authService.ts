/**
 * Authentication Service Bridge
 * This file bridges the existing auth directory with the new Supabase implementation
 * It re-exports the Supabase authService to maintain compatibility
 */

// Re-export the Supabase auth service
export { authService } from '../supabase/authService';

// Re-export commonly used methods for convenience
import { authService as supabaseAuthService } from '../supabase/authService';

export const login = supabaseAuthService.login.bind(supabaseAuthService);
export const logout = supabaseAuthService.logout.bind(supabaseAuthService);
export const register = supabaseAuthService.register.bind(supabaseAuthService);
export const refreshToken = supabaseAuthService.refreshToken.bind(supabaseAuthService);
export const getCurrentUser = supabaseAuthService.getCurrentUser.bind(supabaseAuthService);
export const requestPasswordReset = supabaseAuthService.requestPasswordReset.bind(supabaseAuthService);
export const confirmPasswordReset = supabaseAuthService.confirmPasswordReset.bind(supabaseAuthService);
export const hasPermission = supabaseAuthService.hasPermission.bind(supabaseAuthService);
export const hasAnyPermission = supabaseAuthService.hasAnyPermission.bind(supabaseAuthService);
export const hasAllPermissions = supabaseAuthService.hasAllPermissions.bind(supabaseAuthService);