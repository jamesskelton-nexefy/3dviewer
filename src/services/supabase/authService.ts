import { supabase, handleSupabaseError, sessionManager, ACCESS_TOKEN_EXPIRY, REFRESH_TOKEN_EXPIRY } from './supabaseClient';
import { 
  User, 
  LoginCredentials, 
  RegisterData, 
  TokenResponse, 
  PasswordResetRequest,
  PasswordResetConfirm,
  AuthError,
  AuthErrorType,
  UserRole,
  ROLE_PERMISSIONS,
  JWTPayload
} from '../../types/auth';
import { Session, AuthResponse } from '@supabase/supabase-js';

/**
 * Authentication Service
 * Handles all authentication operations including login, registration,
 * password reset, and session management
 */
export class AuthService {
  private refreshTokenTimer: NodeJS.Timeout | null = null;

  /**
   * Initialize the auth service and set up session monitoring
   */
  constructor() {
    this.setupSessionMonitoring();
  }

  /**
   * Login with email and password
   */
  async login(credentials: LoginCredentials): Promise<{ user: User; tokens: TokenResponse }> {
    try {
      const { data, error }: AuthResponse = await supabase.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password
      });

      if (error) {
        throw handleSupabaseError(error);
      }

      if (!data.session || !data.user) {
        throw {
          type: AuthErrorType.INVALID_CREDENTIALS,
          message: 'Invalid login response'
        } as AuthError;
      }

      // Fetch user profile with role and permissions
      const user = await this.getUserProfile(data.user.id);
      
      // Set up automatic token refresh
      this.scheduleTokenRefresh(data.session);

      // Return user and tokens
      return {
        user,
        tokens: this.extractTokens(data.session)
      };
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  /**
   * Register a new user
   */
  async register(data: RegisterData): Promise<{ user: User; tokens: TokenResponse }> {
    try {
      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            first_name: data.firstName,
            last_name: data.lastName,
            role: data.role || UserRole.VIEWER
          }
        }
      });

      if (authError) {
        throw handleSupabaseError(authError);
      }

      if (!authData.session || !authData.user) {
        throw {
          type: AuthErrorType.USER_NOT_FOUND,
          message: 'Registration failed'
        } as AuthError;
      }

      // Create user profile in the database
      const user = await this.createUserProfile({
        id: authData.user.id,
        email: authData.user.email!,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role || UserRole.VIEWER
      });

      // Set up automatic token refresh
      this.scheduleTokenRefresh(authData.session);

      return {
        user,
        tokens: this.extractTokens(authData.session)
      };
    } catch (error) {
      console.error('Registration error:', error);
      throw error;
    }
  }

  /**
   * Logout the current user
   */
  async logout(): Promise<void> {
    try {
      // Clear refresh token timer
      if (this.refreshTokenTimer) {
        clearTimeout(this.refreshTokenTimer);
        this.refreshTokenTimer = null;
      }

      // Sign out from Supabase
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw handleSupabaseError(error);
      }

      // Clear any stored tokens
      this.clearStoredTokens();
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  }

  /**
   * Refresh the access token
   */
  async refreshToken(): Promise<TokenResponse> {
    try {
      const session = await sessionManager.refreshSession();
      
      if (!session) {
        throw {
          type: AuthErrorType.TOKEN_EXPIRED,
          message: 'Failed to refresh token'
        } as AuthError;
      }

      // Reschedule token refresh
      this.scheduleTokenRefresh(session);

      return this.extractTokens(session);
    } catch (error) {
      console.error('Token refresh error:', error);
      throw error;
    }
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(request: PasswordResetRequest): Promise<void> {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(request.email, {
        redirectTo: `${window.location.origin}/reset-password`
      });

      if (error) {
        throw handleSupabaseError(error);
      }
    } catch (error) {
      console.error('Password reset request error:', error);
      throw error;
    }
  }

  /**
   * Confirm password reset with token
   */
  async confirmPasswordReset(data: PasswordResetConfirm): Promise<void> {
    try {
      const { error } = await supabase.auth.updateUser({
        password: data.newPassword
      });

      if (error) {
        throw handleSupabaseError(error);
      }
    } catch (error) {
      console.error('Password reset confirmation error:', error);
      throw error;
    }
  }

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<User | null> {
    try {
      const session = await sessionManager.getSession();
      
      if (!session || !session.user) {
        return null;
      }

      return await this.getUserProfile(session.user.id);
    } catch (error) {
      console.error('Get current user error:', error);
      return null;
    }
  }

  /**
   * Verify email with token
   */
  async verifyEmail(token: string): Promise<void> {
    try {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: 'email'
      });

      if (error) {
        throw handleSupabaseError(error);
      }
    } catch (error) {
      console.error('Email verification error:', error);
      throw error;
    }
  }

  /**
   * Check if user has specific permission
   */
  hasPermission(user: User, permission: string): boolean {
    return user.permissions.includes(permission as any);
  }

  /**
   * Check if user has any of the specified permissions
   */
  hasAnyPermission(user: User, permissions: string[]): boolean {
    return permissions.some(permission => this.hasPermission(user, permission));
  }

  /**
   * Check if user has all specified permissions
   */
  hasAllPermissions(user: User, permissions: string[]): boolean {
    return permissions.every(permission => this.hasPermission(user, permission));
  }

  /**
   * Decode JWT token (for client-side inspection only)
   */
  decodeToken(token: string): JWTPayload | null {
    try {
      const base64Payload = token.split('.')[1];
      const payload = atob(base64Payload);
      return JSON.parse(payload);
    } catch (error) {
      console.error('Token decode error:', error);
      return null;
    }
  }

  // Private methods

  /**
   * Get user profile from database
   */
  private async getUserProfile(userId: string): Promise<User> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) {
      // If profile doesn't exist, create a default one
      const { data: authUser } = await supabase.auth.getUser();
      if (authUser.user) {
        return this.createUserProfile({
          id: authUser.user.id,
          email: authUser.user.email!,
          firstName: authUser.user.user_metadata?.first_name || '',
          lastName: authUser.user.user_metadata?.last_name || '',
          role: authUser.user.user_metadata?.role || UserRole.VIEWER
        });
      }
      throw {
        type: AuthErrorType.USER_NOT_FOUND,
        message: 'User profile not found'
      } as AuthError;
    }

    // Add permissions based on role
    const permissions = ROLE_PERMISSIONS[data.role as UserRole] || [];

    return {
      ...data,
      permissions,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      lastLoginAt: data.last_login_at,
      isActive: data.is_active,
      emailVerified: data.email_verified
    };
  }

  /**
   * Create user profile in database
   */
  private async createUserProfile(userData: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
  }): Promise<User> {
    const { data, error } = await supabase
      .from('users')
      .insert({
        id: userData.id,
        email: userData.email,
        first_name: userData.firstName,
        last_name: userData.lastName,
        role: userData.role,
        is_active: true,
        email_verified: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      throw handleSupabaseError(error);
    }

    const permissions = ROLE_PERMISSIONS[userData.role] || [];

    return {
      id: data.id,
      email: data.email,
      firstName: data.first_name,
      lastName: data.last_name,
      role: data.role,
      permissions,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      isActive: data.is_active,
      emailVerified: data.email_verified
    };
  }

  /**
   * Extract tokens from session
   */
  private extractTokens(session: Session): TokenResponse {
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token!,
      expiresIn: session.expires_in || ACCESS_TOKEN_EXPIRY,
      tokenType: 'Bearer'
    };
  }

  /**
   * Schedule automatic token refresh
   */
  private scheduleTokenRefresh(session: Session): void {
    // Clear existing timer
    if (this.refreshTokenTimer) {
      clearTimeout(this.refreshTokenTimer);
    }

    // Calculate when to refresh (5 minutes before expiry)
    const timeUntilExpiry = sessionManager.getTimeUntilExpiry(session);
    const refreshTime = Math.max(0, timeUntilExpiry - 5 * 60 * 1000);

    if (refreshTime > 0) {
      this.refreshTokenTimer = setTimeout(async () => {
        try {
          await this.refreshToken();
        } catch (error) {
          console.error('Auto refresh failed:', error);
          // Emit event for the app to handle
          window.dispatchEvent(new CustomEvent('auth:token-refresh-failed', { detail: error }));
        }
      }, refreshTime);
    }
  }

  /**
   * Set up session monitoring
   */
  private setupSessionMonitoring(): void {
    // Listen for auth state changes
    supabase.auth.onAuthStateChange(async (event, session) => {
      switch (event) {
        case 'SIGNED_IN':
          if (session) {
            this.scheduleTokenRefresh(session);
          }
          break;
        case 'SIGNED_OUT':
          if (this.refreshTokenTimer) {
            clearTimeout(this.refreshTokenTimer);
            this.refreshTokenTimer = null;
          }
          break;
        case 'TOKEN_REFRESHED':
          if (session) {
            this.scheduleTokenRefresh(session);
          }
          break;
        case 'USER_UPDATED':
          // Handle user updates
          break;
      }

      // Emit custom event for the app to handle
      window.dispatchEvent(new CustomEvent('auth:state-change', { 
        detail: { event, session } 
      }));
    });
  }

  /**
   * Clear stored tokens
   */
  private clearStoredTokens(): void {
    // Clear any locally stored tokens
    localStorage.removeItem('supabase.auth.token');
    sessionStorage.removeItem('supabase.auth.token');
  }
}

// Export singleton instance
export const authService = new AuthService();