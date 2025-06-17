import { supabase, handleSupabaseError } from './supabaseClient';
import { 
  User, 
  UserRole, 
  Permission, 
  ROLE_PERMISSIONS,
  AuthError,
  AuthErrorType
} from '../../types/auth';

/**
 * Role-Based Access Control (RBAC) Service
 * Manages user roles, permissions, and access control
 */
export class RBACService {
  /**
   * Get all available roles
   */
  getRoles(): UserRole[] {
    return Object.values(UserRole);
  }

  /**
   * Get permissions for a specific role
   */
  getRolePermissions(role: UserRole): Permission[] {
    return ROLE_PERMISSIONS[role] || [];
  }

  /**
   * Check if a role has a specific permission
   */
  roleHasPermission(role: UserRole, permission: Permission): boolean {
    const permissions = this.getRolePermissions(role);
    return permissions.includes(permission);
  }

  /**
   * Update user role
   */
  async updateUserRole(userId: string, newRole: UserRole): Promise<User> {
    try {
      // Check if current user has permission to manage users
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        throw {
          type: AuthErrorType.USER_NOT_FOUND,
          message: 'Current user not found'
        } as AuthError;
      }

      // Get current user's profile to check permissions
      const { data: currentUserProfile } = await supabase
        .from('users')
        .select('role')
        .eq('id', currentUser.id)
        .single();

      if (!currentUserProfile || currentUserProfile.role !== UserRole.ADMINISTRATOR) {
        throw {
          type: AuthErrorType.INSUFFICIENT_PERMISSIONS,
          message: 'Only administrators can update user roles'
        } as AuthError;
      }

      // Update user role
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
        throw handleSupabaseError(error);
      }

      // Return updated user with new permissions
      const permissions = this.getRolePermissions(newRole);
      return {
        ...data,
        permissions,
        firstName: data.first_name,
        lastName: data.last_name,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        lastLoginAt: data.last_login_at,
        isActive: data.is_active,
        emailVerified: data.email_verified
      };
    } catch (error) {
      console.error('Update user role error:', error);
      throw error;
    }
  }

  /**
   * Get all users with their roles (admin only)
   */
  async getAllUsers(): Promise<User[]> {
    try {
      // Check if current user has permission
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        throw {
          type: AuthErrorType.USER_NOT_FOUND,
          message: 'Current user not found'
        } as AuthError;
      }

      // Get current user's profile
      const { data: currentUserProfile } = await supabase
        .from('users')
        .select('role')
        .eq('id', currentUser.id)
        .single();

      if (!currentUserProfile || currentUserProfile.role !== UserRole.ADMINISTRATOR) {
        throw {
          type: AuthErrorType.INSUFFICIENT_PERMISSIONS,
          message: 'Only administrators can view all users'
        } as AuthError;
      }

      // Get all users
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        throw handleSupabaseError(error);
      }

      // Map users with permissions
      return data.map(user => ({
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        permissions: this.getRolePermissions(user.role),
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        lastLoginAt: user.last_login_at,
        isActive: user.is_active,
        emailVerified: user.email_verified
      }));
    } catch (error) {
      console.error('Get all users error:', error);
      throw error;
    }
  }

  /**
   * Activate or deactivate a user
   */
  async setUserActiveStatus(userId: string, isActive: boolean): Promise<void> {
    try {
      // Check permissions
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        throw {
          type: AuthErrorType.USER_NOT_FOUND,
          message: 'Current user not found'
        } as AuthError;
      }

      const { data: currentUserProfile } = await supabase
        .from('users')
        .select('role')
        .eq('id', currentUser.id)
        .single();

      if (!currentUserProfile || currentUserProfile.role !== UserRole.ADMINISTRATOR) {
        throw {
          type: AuthErrorType.INSUFFICIENT_PERMISSIONS,
          message: 'Only administrators can activate/deactivate users'
        } as AuthError;
      }

      // Prevent self-deactivation
      if (userId === currentUser.id && !isActive) {
        throw {
          type: AuthErrorType.INSUFFICIENT_PERMISSIONS,
          message: 'Cannot deactivate your own account'
        } as AuthError;
      }

      // Update user status
      const { error } = await supabase
        .from('users')
        .update({ 
          is_active: isActive,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        throw handleSupabaseError(error);
      }
    } catch (error) {
      console.error('Set user active status error:', error);
      throw error;
    }
  }

  /**
   * Create a permission check middleware
   */
  createPermissionCheck(requiredPermissions: Permission[], requireAll = false) {
    return async (user: User | null): Promise<boolean> => {
      if (!user) {
        return false;
      }

      if (requireAll) {
        return requiredPermissions.every(permission => 
          user.permissions.includes(permission)
        );
      } else {
        return requiredPermissions.some(permission => 
          user.permissions.includes(permission)
        );
      }
    };
  }

  /**
   * Get user's highest permission level
   */
  getUserPermissionLevel(user: User): 'admin' | 'collaborator' | 'viewer' {
    switch (user.role) {
      case UserRole.ADMINISTRATOR:
        return 'admin';
      case UserRole.COLLABORATOR:
        return 'collaborator';
      case UserRole.VIEWER:
      default:
        return 'viewer';
    }
  }

  /**
   * Check if user can perform action on resource
   */
  async canPerformAction(
    user: User,
    action: Permission,
    resourceOwnerId?: string
  ): Promise<boolean> {
    // Check if user has the required permission
    if (!user.permissions.includes(action)) {
      return false;
    }

    // For certain actions, check resource ownership
    if (resourceOwnerId) {
      const ownershipActions = [
        Permission.EDIT_ANNOTATIONS,
        Permission.DELETE_ANNOTATIONS,
        Permission.EDIT_COMMENTS,
        Permission.DELETE_COMMENTS
      ];

      if (ownershipActions.includes(action)) {
        // Admins can always perform actions
        if (user.role === UserRole.ADMINISTRATOR) {
          return true;
        }
        // Others can only perform actions on their own resources
        return user.id === resourceOwnerId;
      }
    }

    return true;
  }

  /**
   * Get permission hierarchy
   */
  getPermissionHierarchy(): Record<string, Permission[]> {
    return {
      'System Management': [
        Permission.MANAGE_USERS,
        Permission.MANAGE_SYSTEM,
        Permission.VIEW_ANALYTICS
      ],
      'Model Management': [
        Permission.UPLOAD_MODELS,
        Permission.DELETE_MODELS,
        Permission.MANAGE_MODEL_VERSIONS,
        Permission.VIEW_MODELS
      ],
      'Collaboration': [
        Permission.CREATE_ANNOTATIONS,
        Permission.EDIT_ANNOTATIONS,
        Permission.DELETE_ANNOTATIONS,
        Permission.VIEW_ANNOTATIONS
      ],
      'Comments': [
        Permission.CREATE_COMMENTS,
        Permission.EDIT_COMMENTS,
        Permission.DELETE_COMMENTS,
        Permission.VIEW_COMMENTS
      ],
      'Sharing': [
        Permission.CREATE_SHARE_LINKS,
        Permission.MANAGE_SHARE_LINKS
      ]
    };
  }
}

// Export singleton instance
export const rbacService = new RBACService();