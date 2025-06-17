import { supabase, sessionManager } from './supabaseClient';
import { authService } from './authService';
import { AuthError, AuthErrorType, Permission } from '../../types/auth';

/**
 * Middleware for Supabase authentication and authorization
 */

/**
 * Authentication middleware - ensures user is authenticated
 */
export const requireAuth = async (): Promise<boolean> => {
  try {
    const session = await sessionManager.getSession();
    
    if (!session) {
      throw {
        type: AuthErrorType.SESSION_EXPIRED,
        message: 'No active session'
      } as AuthError;
    }

    // Check if session is expired
    if (sessionManager.isSessionExpired(session)) {
      // Try to refresh
      const refreshedSession = await sessionManager.refreshSession();
      if (!refreshedSession) {
        throw {
          type: AuthErrorType.TOKEN_EXPIRED,
          message: 'Session expired'
        } as AuthError;
      }
    }

    return true;
  } catch (error) {
    console.error('Auth middleware error:', error);
    return false;
  }
};

/**
 * Permission middleware - ensures user has required permissions
 */
export const requirePermissions = (
  permissions: Permission[], 
  requireAll = false
) => {
  return async (): Promise<boolean> => {
    try {
      // First check authentication
      const isAuthenticated = await requireAuth();
      if (!isAuthenticated) {
        return false;
      }

      // Get current user
      const user = await authService.getCurrentUser();
      if (!user) {
        return false;
      }

      // Check permissions
      if (requireAll) {
        return authService.hasAllPermissions(user, permissions as unknown as string[]);
      } else {
        return authService.hasAnyPermission(user, permissions as unknown as string[]);
      }
    } catch (error) {
      console.error('Permission middleware error:', error);
      return false;
    }
  };
};

/**
 * Role middleware - ensures user has required role
 */
export const requireRole = (roles: string[]) => {
  return async (): Promise<boolean> => {
    try {
      // First check authentication
      const isAuthenticated = await requireAuth();
      if (!isAuthenticated) {
        return false;
      }

      // Get current user
      const user = await authService.getCurrentUser();
      if (!user) {
        return false;
      }

      // Check role
      return roles.includes(user.role);
    } catch (error) {
      console.error('Role middleware error:', error);
      return false;
    }
  };
};

/**
 * Create axios interceptor for adding auth headers
 */
export const createAuthInterceptor = () => {
  return async (config: any) => {
    try {
      const session = await sessionManager.getSession();
      
      if (session) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${session.access_token}`;
      }
    } catch (error) {
      console.error('Auth interceptor error:', error);
    }
    
    return config;
  };
};

/**
 * Create fetch wrapper with auth headers
 */
export const authFetch = async (
  url: string, 
  options: RequestInit = {}
): Promise<Response> => {
  try {
    const session = await sessionManager.getSession();
    
    if (session) {
      options.headers = {
        ...options.headers,
        'Authorization': `Bearer ${session.access_token}`
      };
    }
  } catch (error) {
    console.error('Auth fetch error:', error);
  }
  
  return fetch(url, options);
};

/**
 * Create WebSocket connection with auth
 */
export const createAuthenticatedWebSocket = async (
  url: string
): Promise<WebSocket | null> => {
  try {
    const session = await sessionManager.getSession();
    
    if (!session) {
      throw new Error('No active session');
    }

    // Add token to URL as query parameter
    const wsUrl = new URL(url);
    wsUrl.searchParams.append('token', session.access_token);
    
    return new WebSocket(wsUrl.toString());
  } catch (error) {
    console.error('Authenticated WebSocket error:', error);
    return null;
  }
};

/**
 * Handle API errors with auth retry
 */
export const handleApiError = async (
  error: any,
  retryFn: () => Promise<any>
): Promise<any> => {
  // Check if error is auth-related
  if (error.status === 401 || error.message?.includes('JWT expired')) {
    try {
      // Try to refresh token
      await authService.refreshToken();
      
      // Retry the original request
      return await retryFn();
    } catch (refreshError) {
      // Refresh failed, user needs to login again
      window.dispatchEvent(new CustomEvent('auth:session-expired'));
      throw refreshError;
    }
  }
  
  // Not an auth error, throw as is
  throw error;
};

/**
 * Create Supabase middleware for various frameworks
 */
export const createSupabaseMiddleware = (framework: 'express' | 'koa' | 'fastify') => {
  switch (framework) {
    case 'express':
      return async (req: any, res: any, next: any) => {
        try {
          const authHeader = req.headers.authorization;
          if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
          }

          const token = authHeader.substring(7);
          const { data: { user }, error } = await supabase.auth.getUser(token);

          if (error || !user) {
            return res.status(401).json({ error: 'Invalid token' });
          }

          req.user = user;
          next();
        } catch (error) {
          res.status(500).json({ error: 'Server error' });
        }
      };

    case 'koa':
      return async (ctx: any, next: any) => {
        try {
          const authHeader = ctx.headers.authorization;
          if (!authHeader || !authHeader.startsWith('Bearer ')) {
            ctx.status = 401;
            ctx.body = { error: 'No token provided' };
            return;
          }

          const token = authHeader.substring(7);
          const { data: { user }, error } = await supabase.auth.getUser(token);

          if (error || !user) {
            ctx.status = 401;
            ctx.body = { error: 'Invalid token' };
            return;
          }

          ctx.state.user = user;
          await next();
        } catch (error) {
          ctx.status = 500;
          ctx.body = { error: 'Server error' };
        }
      };

    case 'fastify':
      return async (request: any, reply: any) => {
        try {
          const authHeader = request.headers.authorization;
          if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.code(401).send({ error: 'No token provided' });
          }

          const token = authHeader.substring(7);
          const { data: { user }, error } = await supabase.auth.getUser(token);

          if (error || !user) {
            return reply.code(401).send({ error: 'Invalid token' });
          }

          request.user = user;
        } catch (error) {
          return reply.code(500).send({ error: 'Server error' });
        }
      };

    default:
      throw new Error(`Unsupported framework: ${framework}`);
  }
};