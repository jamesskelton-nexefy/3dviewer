/**
 * Authentication and Authorization Types
 * Defines all types related to user authentication, roles, and permissions
 */

// User Roles based on RBAC requirements
export enum UserRole {
  ADMINISTRATOR = 'administrator',
  COLLABORATOR = 'collaborator',
  VIEWER = 'viewer'
}

// Permissions for each role
export enum Permission {
  // System permissions
  MANAGE_USERS = 'manage_users',
  MANAGE_SYSTEM = 'manage_system',
  VIEW_ANALYTICS = 'view_analytics',
  
  // Model permissions
  UPLOAD_MODELS = 'upload_models',
  DELETE_MODELS = 'delete_models',
  MANAGE_MODEL_VERSIONS = 'manage_model_versions',
  VIEW_MODELS = 'view_models',
  
  // Collaboration permissions
  CREATE_ANNOTATIONS = 'create_annotations',
  EDIT_ANNOTATIONS = 'edit_annotations',
  DELETE_ANNOTATIONS = 'delete_annotations',
  VIEW_ANNOTATIONS = 'view_annotations',
  
  // Comment permissions
  CREATE_COMMENTS = 'create_comments',
  EDIT_COMMENTS = 'edit_comments',
  DELETE_COMMENTS = 'delete_comments',
  VIEW_COMMENTS = 'view_comments',
  
  // Sharing permissions
  CREATE_SHARE_LINKS = 'create_share_links',
  MANAGE_SHARE_LINKS = 'manage_share_links'
}

// User profile interface
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatar?: string;
  role: UserRole;
  permissions: Permission[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  isActive: boolean;
  emailVerified: boolean;
}

// Authentication state
export interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  sessionExpiry: number | null;
}

// Login credentials
export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

// Registration data
export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
}

// Token response from authentication
export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

// JWT Token payload
export interface JWTPayload {
  sub: string; // user id
  email: string;
  role: UserRole;
  permissions: Permission[];
  iat: number; // issued at
  exp: number; // expires at
  jti: string; // JWT ID
}

// Password reset request
export interface PasswordResetRequest {
  email: string;
}

// Password reset confirmation
export interface PasswordResetConfirm {
  token: string;
  newPassword: string;
}

// Session information
export interface SessionInfo {
  id: string;
  userId: string;
  userAgent: string;
  ipAddress: string;
  createdAt: string;
  lastActivityAt: string;
  isActive: boolean;
}

// Sharing link interface
export interface ShareLink {
  id: string;
  modelId: string;
  token: string;
  expiresAt: string;
  permissions: Permission[];
  createdBy: string;
  createdAt: string;
  maxUses?: number;
  currentUses: number;
  isActive: boolean;
}

// Authentication error types
export enum AuthErrorType {
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  USER_INACTIVE = 'USER_INACTIVE',
  EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  NETWORK_ERROR = 'NETWORK_ERROR'
}

// Authentication error interface
export interface AuthError {
  type: AuthErrorType;
  message: string;
  code?: string;
  details?: Record<string, any>;
}

// Role permission mapping
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.ADMINISTRATOR]: [
    // System permissions
    Permission.MANAGE_USERS,
    Permission.MANAGE_SYSTEM,
    Permission.VIEW_ANALYTICS,
    
    // Model permissions
    Permission.UPLOAD_MODELS,
    Permission.DELETE_MODELS,
    Permission.MANAGE_MODEL_VERSIONS,
    Permission.VIEW_MODELS,
    
    // Collaboration permissions
    Permission.CREATE_ANNOTATIONS,
    Permission.EDIT_ANNOTATIONS,
    Permission.DELETE_ANNOTATIONS,
    Permission.VIEW_ANNOTATIONS,
    
    // Comment permissions
    Permission.CREATE_COMMENTS,
    Permission.EDIT_COMMENTS,
    Permission.DELETE_COMMENTS,
    Permission.VIEW_COMMENTS,
    
    // Sharing permissions
    Permission.CREATE_SHARE_LINKS,
    Permission.MANAGE_SHARE_LINKS
  ],
  
  [UserRole.COLLABORATOR]: [
    // Model permissions
    Permission.UPLOAD_MODELS,
    Permission.VIEW_MODELS,
    
    // Collaboration permissions
    Permission.CREATE_ANNOTATIONS,
    Permission.EDIT_ANNOTATIONS,
    Permission.VIEW_ANNOTATIONS,
    
    // Comment permissions
    Permission.CREATE_COMMENTS,
    Permission.EDIT_COMMENTS,
    Permission.VIEW_COMMENTS,
    
    // Sharing permissions
    Permission.CREATE_SHARE_LINKS
  ],
  
  [UserRole.VIEWER]: [
    // Model permissions
    Permission.VIEW_MODELS,
    
    // Collaboration permissions
    Permission.VIEW_ANNOTATIONS,
    
    // Comment permissions
    Permission.VIEW_COMMENTS
  ]
};