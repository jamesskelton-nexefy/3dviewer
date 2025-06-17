import { supabase, handleSupabaseError, sessionManager } from './supabaseClient';
import { 
  SessionInfo,
  AuthError,
  AuthErrorType,
  User
} from '../../types/auth';
import { Session } from '@supabase/supabase-js';

/**
 * Session Management Service
 * Handles session tracking, monitoring, and security
 */
export class SessionService {
  private sessionCheckInterval: NodeJS.Timeout | null = null;
  private readonly SESSION_CHECK_INTERVAL = 60000; // 1 minute

  /**
   * Initialize session monitoring
   */
  startSessionMonitoring(): void {
    // Clear any existing interval
    this.stopSessionMonitoring();

    // Set up periodic session validation
    this.sessionCheckInterval = setInterval(async () => {
      await this.validateCurrentSession();
    }, this.SESSION_CHECK_INTERVAL);

    // Also check on visibility change
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  /**
   * Stop session monitoring
   */
  stopSessionMonitoring(): void {
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
      this.sessionCheckInterval = null;
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  /**
   * Create a new session record
   */
  async createSession(userId: string, session: Session): Promise<SessionInfo> {
    try {
      const sessionInfo = {
        id: session.access_token.substring(0, 36), // Use part of token as ID
        user_id: userId,
        user_agent: navigator.userAgent,
        ip_address: await this.getClientIP(),
        created_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        is_active: true,
        expires_at: new Date(session.expires_at! * 1000).toISOString()
      };

      const { data, error } = await supabase
        .from('sessions')
        .insert(sessionInfo)
        .select()
        .single();

      if (error) {
        console.error('Failed to create session record:', error);
        // Don't throw - session creation failure shouldn't block login
      }

      return {
        id: data?.id || sessionInfo.id,
        userId: data?.user_id || userId,
        userAgent: data?.user_agent || sessionInfo.user_agent,
        ipAddress: data?.ip_address || sessionInfo.ip_address,
        createdAt: data?.created_at || sessionInfo.created_at,
        lastActivityAt: data?.last_activity_at || sessionInfo.last_activity_at,
        isActive: data?.is_active ?? true
      };
    } catch (error) {
      console.error('Create session error:', error);
      // Return a basic session info even if database fails
      return {
        id: session.access_token.substring(0, 36),
        userId,
        userAgent: navigator.userAgent,
        ipAddress: 'unknown',
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        isActive: true
      };
    }
  }

  /**
   * Update session activity
   */
  async updateSessionActivity(sessionId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('sessions')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('is_active', true);

      if (error) {
        console.error('Failed to update session activity:', error);
      }
    } catch (error) {
      console.error('Update session activity error:', error);
    }
  }

  /**
   * Get active sessions for a user
   */
  async getUserSessions(userId: string): Promise<SessionInfo[]> {
    try {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('last_activity_at', { ascending: false });

      if (error) {
        throw handleSupabaseError(error);
      }

      return data.map(session => ({
        id: session.id,
        userId: session.user_id,
        userAgent: session.user_agent,
        ipAddress: session.ip_address,
        createdAt: session.created_at,
        lastActivityAt: session.last_activity_at,
        isActive: session.is_active
      }));
    } catch (error) {
      console.error('Get user sessions error:', error);
      throw error;
    }
  }

  /**
   * Terminate a specific session
   */
  async terminateSession(sessionId: string): Promise<void> {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw {
          type: AuthErrorType.USER_NOT_FOUND,
          message: 'User not authenticated'
        } as AuthError;
      }

      // Mark session as inactive
      const { error } = await supabase
        .from('sessions')
        .update({ is_active: false })
        .eq('id', sessionId)
        .eq('user_id', user.id);

      if (error) {
        throw handleSupabaseError(error);
      }

      // If it's the current session, sign out
      const currentSession = await sessionManager.getSession();
      if (currentSession && sessionId === currentSession.access_token.substring(0, 36)) {
        await supabase.auth.signOut();
      }
    } catch (error) {
      console.error('Terminate session error:', error);
      throw error;
    }
  }

  /**
   * Terminate all sessions for a user except current
   */
  async terminateAllOtherSessions(userId: string): Promise<void> {
    try {
      const currentSession = await sessionManager.getSession();
      if (!currentSession) {
        throw {
          type: AuthErrorType.SESSION_EXPIRED,
          message: 'No active session'
        } as AuthError;
      }

      const currentSessionId = currentSession.access_token.substring(0, 36);

      const { error } = await supabase
        .from('sessions')
        .update({ is_active: false })
        .eq('user_id', userId)
        .neq('id', currentSessionId);

      if (error) {
        throw handleSupabaseError(error);
      }
    } catch (error) {
      console.error('Terminate all other sessions error:', error);
      throw error;
    }
  }

  /**
   * Validate current session
   */
  async validateCurrentSession(): Promise<boolean> {
    try {
      const session = await sessionManager.getSession();
      
      if (!session) {
        return false;
      }

      // Check if session is expired
      if (sessionManager.isSessionExpired(session)) {
        // Try to refresh
        const refreshedSession = await sessionManager.refreshSession();
        if (!refreshedSession) {
          await this.handleSessionExpired();
          return false;
        }
      }

      // Update activity
      const sessionId = session.access_token.substring(0, 36);
      await this.updateSessionActivity(sessionId);

      return true;
    } catch (error) {
      console.error('Validate session error:', error);
      return false;
    }
  }

  /**
   * Handle expired session
   */
  private async handleSessionExpired(): Promise<void> {
    // Stop monitoring
    this.stopSessionMonitoring();

    // Emit event for the app to handle
    window.dispatchEvent(new CustomEvent('auth:session-expired'));

    // Sign out
    await supabase.auth.signOut();
  }

  /**
   * Handle visibility change
   */
  private handleVisibilityChange = async (): Promise<void> => {
    if (!document.hidden) {
      // Page is visible again, validate session
      await this.validateCurrentSession();
    }
  };

  /**
   * Get client IP address
   */
  private async getClientIP(): Promise<string> {
    try {
      // In production, this would be handled by the backend
      // For now, return a placeholder
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('sessions')
        .update({ is_active: false })
        .lt('expires_at', new Date().toISOString())
        .eq('is_active', true)
        .select();

      if (error) {
        throw handleSupabaseError(error);
      }

      return data?.length || 0;
    } catch (error) {
      console.error('Cleanup expired sessions error:', error);
      throw error;
    }
  }

  /**
   * Get session statistics for a user
   */
  async getSessionStats(userId: string): Promise<{
    activeSessions: number;
    totalSessions: number;
    lastActivity: string | null;
    devices: string[];
  }> {
    try {
      // Get all sessions
      const { data: allSessions, error: allError } = await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (allError) {
        throw handleSupabaseError(allError);
      }

      // Get active sessions
      const activeSessions = allSessions.filter(s => s.is_active);

      // Extract unique devices
      const devices = [...new Set(allSessions.map(s => {
        const ua = s.user_agent;
        if (ua.includes('Mobile')) return 'Mobile';
        if (ua.includes('Tablet')) return 'Tablet';
        return 'Desktop';
      }))];

      return {
        activeSessions: activeSessions.length,
        totalSessions: allSessions.length,
        lastActivity: activeSessions[0]?.last_activity_at || null,
        devices
      };
    } catch (error) {
      console.error('Get session stats error:', error);
      throw error;
    }
  }

  /**
   * Detect suspicious session activity
   */
  async detectSuspiciousActivity(userId: string): Promise<{
    suspicious: boolean;
    reasons: string[];
  }> {
    try {
      const sessions = await this.getUserSessions(userId);
      const reasons: string[] = [];

      // Check for multiple active sessions from different IPs
      const uniqueIPs = [...new Set(sessions.map(s => s.ipAddress))];
      if (uniqueIPs.length > 3) {
        reasons.push('Multiple sessions from different IP addresses');
      }

      // Check for rapid session creation
      const recentSessions = sessions.filter(s => {
        const createdAt = new Date(s.createdAt);
        const hourAgo = new Date(Date.now() - 3600000);
        return createdAt > hourAgo;
      });

      if (recentSessions.length > 5) {
        reasons.push('Too many sessions created in the last hour');
      }

      return {
        suspicious: reasons.length > 0,
        reasons
      };
    } catch (error) {
      console.error('Detect suspicious activity error:', error);
      return { suspicious: false, reasons: [] };
    }
  }
}

// Export singleton instance
export const sessionService = new SessionService();