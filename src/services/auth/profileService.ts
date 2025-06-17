/**
 * User Profile Service
 * Handles user profile management, avatar uploads, and profile updates
 */

import { supabase } from '../../config/supabase';
import { User, UserRole } from '../../types/auth';
import { v4 as uuidv4 } from 'uuid';

export interface ProfileUpdateData {
  firstName?: string;
  lastName?: string;
  avatar?: File | string;
  currentPassword?: string;
  newPassword?: string;
}

export interface AvatarUploadResult {
  url: string;
  path: string;
}

class ProfileService {
  private readonly AVATAR_BUCKET = 'avatars';
  private readonly MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5MB
  private readonly ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  /**
   * Get user profile by ID
   */
  async getProfile(userId: string): Promise<User | null> {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (error || !data) {
        return null;
      }

      return this.mapDatabaseUserToUser(data);
    } catch (error) {
      console.error('Failed to get user profile:', error);
      return null;
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(userId: string, updates: ProfileUpdateData): Promise<User> {
    try {
      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      // Handle basic profile updates
      if (updates.firstName !== undefined) {
        updateData.first_name = updates.firstName;
      }

      if (updates.lastName !== undefined) {
        updateData.last_name = updates.lastName;
      }

      // Handle avatar update
      if (updates.avatar) {
        if (typeof updates.avatar === 'string') {
          updateData.avatar_url = updates.avatar;
        } else {
          // Upload new avatar file
          const avatarResult = await this.uploadAvatar(userId, updates.avatar);
          updateData.avatar_url = avatarResult.url;
        }
      }

      const { data, error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update profile: ${error.message}`);
      }

      // Handle password update separately if needed
      if (updates.currentPassword && updates.newPassword) {
        await this.updatePassword(updates.currentPassword, updates.newPassword);
      }

      return this.mapDatabaseUserToUser(data);
    } catch (error) {
      console.error('Profile update failed:', error);
      throw error;
    }
  }

  /**
   * Upload user avatar
   */
  async uploadAvatar(userId: string, file: File): Promise<AvatarUploadResult> {
    try {
      // Validate file
      this.validateAvatarFile(file);

      // Create unique file path
      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}/${uuidv4()}.${fileExt}`;

      // Delete old avatar if exists
      await this.deleteOldAvatar(userId);

      // Upload new avatar
      const { data, error } = await supabase.storage
        .from(this.AVATAR_BUCKET)
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        throw new Error(`Avatar upload failed: ${error.message}`);
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from(this.AVATAR_BUCKET)
        .getPublicUrl(fileName);

      return {
        url: publicUrl,
        path: fileName
      };
    } catch (error) {
      console.error('Avatar upload failed:', error);
      throw error;
    }
  }

  /**
   * Delete user avatar
   */
  async deleteAvatar(userId: string): Promise<void> {
    try {
      await this.deleteOldAvatar(userId);

      // Update user profile to remove avatar URL
      await supabase
        .from('users')
        .update({ 
          avatar_url: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);
    } catch (error) {
      console.error('Avatar deletion failed:', error);
      throw error;
    }
  }

  /**
   * Update user password
   */
  async updatePassword(currentPassword: string, newPassword: string): Promise<void> {
    try {
      // Verify current password by attempting to sign in
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user?.email) {
        throw new Error('User not found');
      }

      // Verify current password
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword
      });

      if (signInError) {
        throw new Error('Current password is incorrect');
      }

      // Update password
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) {
        throw new Error(`Password update failed: ${error.message}`);
      }
    } catch (error) {
      console.error('Password update failed:', error);
      throw error;
    }
  }

  /**
   * Update user role (admin only)
   */
  async updateUserRole(userId: string, newRole: UserRole, adminUserId: string): Promise<User> {
    try {
      // Verify admin has permission
      const admin = await this.getProfile(adminUserId);
      if (!admin || admin.role !== UserRole.ADMINISTRATOR) {
        throw new Error('Insufficient permissions to update user role');
      }

      // Prevent admin from demoting themselves
      if (userId === adminUserId && newRole !== UserRole.ADMINISTRATOR) {
        throw new Error('Cannot change your own admin role');
      }

      const { data, error } = await supabase
        .from('users')
        .update({
          role: newRole,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        throw new Error(`Role update failed: ${error.message}`);
      }

      return this.mapDatabaseUserToUser(data);
    } catch (error) {
      console.error('Role update failed:', error);
      throw error;
    }
  }

  /**
   * Deactivate user account (admin only)
   */
  async deactivateUser(userId: string, adminUserId: string): Promise<void> {
    try {
      // Verify admin has permission
      const admin = await this.getProfile(adminUserId);
      if (!admin || admin.role !== UserRole.ADMINISTRATOR) {
        throw new Error('Insufficient permissions to deactivate user');
      }

      // Prevent admin from deactivating themselves
      if (userId === adminUserId) {
        throw new Error('Cannot deactivate your own account');
      }

      const { error } = await supabase
        .from('users')
        .update({
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        throw new Error(`User deactivation failed: ${error.message}`);
      }

      // Invalidate user sessions
      await supabase
        .from('user_sessions')
        .update({ is_active: false })
        .eq('user_id', userId);
    } catch (error) {
      console.error('User deactivation failed:', error);
      throw error;
    }
  }

  /**
   * Reactivate user account (admin only)
   */
  async reactivateUser(userId: string, adminUserId: string): Promise<void> {
    try {
      // Verify admin has permission
      const admin = await this.getProfile(adminUserId);
      if (!admin || admin.role !== UserRole.ADMINISTRATOR) {
        throw new Error('Insufficient permissions to reactivate user');
      }

      const { error } = await supabase
        .from('users')
        .update({
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        throw new Error(`User reactivation failed: ${error.message}`);
      }
    } catch (error) {
      console.error('User reactivation failed:', error);
      throw error;
    }
  }

  /**
   * Get all users (admin only)
   */
  async getAllUsers(adminUserId: string): Promise<User[]> {
    try {
      // Verify admin has permission
      const admin = await this.getProfile(adminUserId);
      if (!admin || admin.role !== UserRole.ADMINISTRATOR) {
        throw new Error('Insufficient permissions to view all users');
      }

      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to fetch users: ${error.message}`);
      }

      return data.map(user => this.mapDatabaseUserToUser(user));
    } catch (error) {
      console.error('Failed to get all users:', error);
      throw error;
    }
  }

  /**
   * Search users by email or name (admin only)
   */
  async searchUsers(query: string, adminUserId: string): Promise<User[]> {
    try {
      // Verify admin has permission
      const admin = await this.getProfile(adminUserId);
      if (!admin || admin.role !== UserRole.ADMINISTRATOR) {
        throw new Error('Insufficient permissions to search users');
      }

      const { data, error } = await supabase
        .from('users')
        .select('*')
        .or(`email.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        throw new Error(`User search failed: ${error.message}`);
      }

      return data.map(user => this.mapDatabaseUserToUser(user));
    } catch (error) {
      console.error('User search failed:', error);
      throw error;
    }
  }

  /**
   * Validate avatar file
   */
  private validateAvatarFile(file: File): void {
    if (file.size > this.MAX_AVATAR_SIZE) {
      throw new Error(`Avatar file too large. Maximum size is ${this.MAX_AVATAR_SIZE / (1024 * 1024)}MB`);
    }

    if (!this.ALLOWED_AVATAR_TYPES.includes(file.type)) {
      throw new Error(`Invalid avatar file type. Allowed types: ${this.ALLOWED_AVATAR_TYPES.join(', ')}`);
    }
  }

  /**
   * Delete old avatar files
   */
  private async deleteOldAvatar(userId: string): Promise<void> {
    try {
      // List existing avatar files for user
      const { data: files, error } = await supabase.storage
        .from(this.AVATAR_BUCKET)
        .list(userId);

      if (error || !files || files.length === 0) {
        return;
      }

      // Delete all old avatar files
      const filePaths = files.map(file => `${userId}/${file.name}`);
      
      const { error: deleteError } = await supabase.storage
        .from(this.AVATAR_BUCKET)
        .remove(filePaths);

      if (deleteError) {
        console.warn('Failed to delete old avatar files:', deleteError);
      }
    } catch (error) {
      console.warn('Failed to cleanup old avatar files:', error);
    }
  }

  /**
   * Map database user to User interface
   */
  private mapDatabaseUserToUser(dbUser: any): User {
    return {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.first_name,
      lastName: dbUser.last_name,
      avatar: dbUser.avatar_url,
      role: dbUser.role as UserRole,
      permissions: this.getPermissionsForRole(dbUser.role as UserRole),
      createdAt: dbUser.created_at,
      updatedAt: dbUser.updated_at,
      lastLoginAt: dbUser.last_login_at,
      isActive: dbUser.is_active,
      emailVerified: dbUser.email_verified
    };
  }

  /**
   * Get permissions for role
   */
  private getPermissionsForRole(role: UserRole) {
    // This should match the ROLE_PERMISSIONS from auth types
    const { Permission } = require('../../types/auth');
    const { ROLE_PERMISSIONS } = require('../../types/auth');
    return ROLE_PERMISSIONS[role] || [];
  }
}

// Export singleton instance
export const profileService = new ProfileService();