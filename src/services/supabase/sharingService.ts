import { supabase, handleSupabaseError } from './supabaseClient';
import { 
  ShareLink,
  Permission,
  AuthError,
  AuthErrorType,
  User,
  UserRole
} from '../../types/auth';
import { v4 as uuidv4 } from 'uuid';

/**
 * Sharing Service
 * Handles creation and management of time-limited sharing links
 */
export class SharingService {
  /**
   * Create a time-limited sharing link
   */
  async createShareLink(params: {
    modelId: string;
    expiresIn: number; // Duration in seconds
    permissions: Permission[];
    maxUses?: number;
  }): Promise<ShareLink> {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw {
          type: AuthErrorType.USER_NOT_FOUND,
          message: 'User not authenticated'
        } as AuthError;
      }

      // Generate unique token
      const token = this.generateShareToken();
      
      // Calculate expiry date
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + params.expiresIn);

      // Create share link in database
      const { data, error } = await supabase
        .from('share_links')
        .insert({
          id: uuidv4(),
          model_id: params.modelId,
          token,
          expires_at: expiresAt.toISOString(),
          permissions: params.permissions,
          created_by: user.id,
          max_uses: params.maxUses || null,
          current_uses: 0,
          is_active: true,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        throw handleSupabaseError(error);
      }

      return {
        id: data.id,
        modelId: data.model_id,
        token: data.token,
        expiresAt: data.expires_at,
        permissions: data.permissions,
        createdBy: data.created_by,
        createdAt: data.created_at,
        maxUses: data.max_uses,
        currentUses: data.current_uses,
        isActive: data.is_active
      };
    } catch (error) {
      console.error('Create share link error:', error);
      throw error;
    }
  }

  /**
   * Validate a share link token
   */
  async validateShareLink(token: string): Promise<ShareLink | null> {
    try {
      // Get share link by token
      const { data, error } = await supabase
        .from('share_links')
        .select('*')
        .eq('token', token)
        .eq('is_active', true)
        .single();

      if (error || !data) {
        return null;
      }

      // Check if link is expired
      if (new Date(data.expires_at) < new Date()) {
        // Mark as inactive
        await this.deactivateShareLink(data.id);
        return null;
      }

      // Check if max uses reached
      if (data.max_uses && data.current_uses >= data.max_uses) {
        // Mark as inactive
        await this.deactivateShareLink(data.id);
        return null;
      }

      // Increment usage count
      await supabase
        .from('share_links')
        .update({ current_uses: data.current_uses + 1 })
        .eq('id', data.id);

      return {
        id: data.id,
        modelId: data.model_id,
        token: data.token,
        expiresAt: data.expires_at,
        permissions: data.permissions,
        createdBy: data.created_by,
        createdAt: data.created_at,
        maxUses: data.max_uses,
        currentUses: data.current_uses + 1,
        isActive: data.is_active
      };
    } catch (error) {
      console.error('Validate share link error:', error);
      return null;
    }
  }

  /**
   * Get all share links for a model
   */
  async getModelShareLinks(modelId: string): Promise<ShareLink[]> {
    try {
      const { data, error } = await supabase
        .from('share_links')
        .select('*')
        .eq('model_id', modelId)
        .order('created_at', { ascending: false });

      if (error) {
        throw handleSupabaseError(error);
      }

      return data.map(link => ({
        id: link.id,
        modelId: link.model_id,
        token: link.token,
        expiresAt: link.expires_at,
        permissions: link.permissions,
        createdBy: link.created_by,
        createdAt: link.created_at,
        maxUses: link.max_uses,
        currentUses: link.current_uses,
        isActive: link.is_active
      }));
    } catch (error) {
      console.error('Get model share links error:', error);
      throw error;
    }
  }

  /**
   * Get share links created by a user
   */
  async getUserShareLinks(userId: string): Promise<ShareLink[]> {
    try {
      const { data, error } = await supabase
        .from('share_links')
        .select('*')
        .eq('created_by', userId)
        .order('created_at', { ascending: false });

      if (error) {
        throw handleSupabaseError(error);
      }

      return data.map(link => ({
        id: link.id,
        modelId: link.model_id,
        token: link.token,
        expiresAt: link.expires_at,
        permissions: link.permissions,
        createdBy: link.created_by,
        createdAt: link.created_at,
        maxUses: link.max_uses,
        currentUses: link.current_uses,
        isActive: link.is_active
      }));
    } catch (error) {
      console.error('Get user share links error:', error);
      throw error;
    }
  }

  /**
   * Deactivate a share link
   */
  async deactivateShareLink(linkId: string): Promise<void> {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw {
          type: AuthErrorType.USER_NOT_FOUND,
          message: 'User not authenticated'
        } as AuthError;
      }

      // Get share link
      const { data: shareLink } = await supabase
        .from('share_links')
        .select('created_by')
        .eq('id', linkId)
        .single();

      if (!shareLink) {
        throw {
          type: AuthErrorType.USER_NOT_FOUND,
          message: 'Share link not found'
        } as AuthError;
      }

      // Check permissions (only creator or admin can deactivate)
      const { data: currentUserProfile } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();

      if (shareLink.created_by !== user.id && 
          currentUserProfile?.role !== UserRole.ADMINISTRATOR) {
        throw {
          type: AuthErrorType.INSUFFICIENT_PERMISSIONS,
          message: 'Only the creator or administrators can deactivate share links'
        } as AuthError;
      }

      // Deactivate link
      const { error } = await supabase
        .from('share_links')
        .update({ is_active: false })
        .eq('id', linkId);

      if (error) {
        throw handleSupabaseError(error);
      }
    } catch (error) {
      console.error('Deactivate share link error:', error);
      throw error;
    }
  }

  /**
   * Update share link permissions
   */
  async updateShareLinkPermissions(
    linkId: string, 
    permissions: Permission[]
  ): Promise<ShareLink> {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw {
          type: AuthErrorType.USER_NOT_FOUND,
          message: 'User not authenticated'
        } as AuthError;
      }

      // Check permissions
      const { data: shareLink } = await supabase
        .from('share_links')
        .select('created_by')
        .eq('id', linkId)
        .single();

      if (!shareLink || shareLink.created_by !== user.id) {
        throw {
          type: AuthErrorType.INSUFFICIENT_PERMISSIONS,
          message: 'Only the creator can update share link permissions'
        } as AuthError;
      }

      // Update permissions
      const { data, error } = await supabase
        .from('share_links')
        .update({ permissions })
        .eq('id', linkId)
        .select()
        .single();

      if (error) {
        throw handleSupabaseError(error);
      }

      return {
        id: data.id,
        modelId: data.model_id,
        token: data.token,
        expiresAt: data.expires_at,
        permissions: data.permissions,
        createdBy: data.created_by,
        createdAt: data.created_at,
        maxUses: data.max_uses,
        currentUses: data.current_uses,
        isActive: data.is_active
      };
    } catch (error) {
      console.error('Update share link permissions error:', error);
      throw error;
    }
  }

  /**
   * Clean up expired share links
   */
  async cleanupExpiredLinks(): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('share_links')
        .update({ is_active: false })
        .lt('expires_at', new Date().toISOString())
        .eq('is_active', true)
        .select();

      if (error) {
        throw handleSupabaseError(error);
      }

      return data?.length || 0;
    } catch (error) {
      console.error('Cleanup expired links error:', error);
      throw error;
    }
  }

  /**
   * Generate a secure share token
   */
  private generateShareToken(): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const tokenLength = 32;
    let token = '';
    
    const array = new Uint8Array(tokenLength);
    crypto.getRandomValues(array);
    
    for (let i = 0; i < tokenLength; i++) {
      token += characters[array[i] % characters.length];
    }
    
    return token;
  }

  /**
   * Get share link statistics
   */
  async getShareLinkStats(linkId: string): Promise<{
    totalUses: number;
    remainingUses: number | null;
    timeRemaining: number;
    isExpired: boolean;
    isMaxUsesReached: boolean;
  }> {
    try {
      const { data, error } = await supabase
        .from('share_links')
        .select('*')
        .eq('id', linkId)
        .single();

      if (error || !data) {
        throw {
          type: AuthErrorType.USER_NOT_FOUND,
          message: 'Share link not found'
        } as AuthError;
      }

      const now = new Date();
      const expiresAt = new Date(data.expires_at);
      const timeRemaining = Math.max(0, expiresAt.getTime() - now.getTime());
      const isExpired = expiresAt < now;
      const isMaxUsesReached = data.max_uses ? data.current_uses >= data.max_uses : false;

      return {
        totalUses: data.current_uses,
        remainingUses: data.max_uses ? data.max_uses - data.current_uses : null,
        timeRemaining,
        isExpired,
        isMaxUsesReached
      };
    } catch (error) {
      console.error('Get share link stats error:', error);
      throw error;
    }
  }

  /**
   * Create a public share URL
   */
  createShareUrl(token: string): string {
    const baseUrl = window.location.origin;
    return `${baseUrl}/share/${token}`;
  }
}

// Export singleton instance
export const sharingService = new SharingService();