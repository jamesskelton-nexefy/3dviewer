/**
 * Supabase Authentication Examples
 * This file demonstrates how to use the authentication services
 */

import React, { useState, useEffect } from 'react';
import { 
  authService, 
  rbacService, 
  sharingService, 
  sessionService 
} from './index';
import { User, UserRole, Permission, ShareLink } from '../../types/auth';

// Example 1: Login Component
export function LoginExample() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const { user, tokens } = await authService.login({
        email,
        password,
        rememberMe: true
      });
      
      console.log('Logged in user:', user);
      console.log('Access token expires in:', tokens.expiresIn, 'seconds');
      
      // Start session monitoring
      sessionService.startSessionMonitoring();
      
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input 
        type="email" 
        value={email} 
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
      />
      <input 
        type="password" 
        value={password} 
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
      />
      <button onClick={handleLogin} disabled={loading}>
        {loading ? 'Logging in...' : 'Login'}
      </button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}

// Example 2: Registration with Role Selection
export function RegistrationExample() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    role: UserRole.VIEWER
  });

  const handleRegister = async () => {
    try {
      const { user } = await authService.register(formData);
      console.log('Registered user:', user);
      
      // Note: User may need to verify email before logging in
      if (!user.emailVerified) {
        alert('Please check your email to verify your account');
      }
    } catch (err: any) {
      console.error('Registration failed:', err);
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleRegister(); }}>
      <input 
        type="email" 
        value={formData.email}
        onChange={(e) => setFormData({...formData, email: e.target.value})}
        placeholder="Email"
        required
      />
      <input 
        type="password" 
        value={formData.password}
        onChange={(e) => setFormData({...formData, password: e.target.value})}
        placeholder="Password"
        required
      />
      <input 
        type="text" 
        value={formData.firstName}
        onChange={(e) => setFormData({...formData, firstName: e.target.value})}
        placeholder="First Name"
        required
      />
      <input 
        type="text" 
        value={formData.lastName}
        onChange={(e) => setFormData({...formData, lastName: e.target.value})}
        placeholder="Last Name"
        required
      />
      <select 
        value={formData.role}
        onChange={(e) => setFormData({...formData, role: e.target.value as UserRole})}
      >
        <option value={UserRole.VIEWER}>Viewer</option>
        <option value={UserRole.COLLABORATOR}>Collaborator</option>
        <option value={UserRole.ADMINISTRATOR}>Administrator</option>
      </select>
      <button type="submit">Register</button>
    </form>
  );
}

// Example 3: Permission-Based Component
export function PermissionBasedComponent() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    authService.getCurrentUser().then(setUser);
  }, []);

  if (!user) return <div>Loading...</div>;

  return (
    <div>
      <h2>Welcome, {user.firstName} {user.lastName}</h2>
      <p>Role: {user.role}</p>

      {/* Show upload button only if user has permission */}
      {authService.hasPermission(user, Permission.UPLOAD_MODELS) && (
        <button>Upload 3D Model</button>
      )}

      {/* Show admin panel only for administrators */}
      {user.role === UserRole.ADMINISTRATOR && (
        <div>
          <h3>Admin Panel</h3>
          <button onClick={() => window.location.href = '/admin'}>
            Manage Users
          </button>
        </div>
      )}

      {/* Show different options based on permissions */}
      {authService.hasAnyPermission(user, [
        Permission.CREATE_ANNOTATIONS,
        Permission.CREATE_COMMENTS
      ]) && (
        <div>
          <h3>Collaboration Tools</h3>
          {authService.hasPermission(user, Permission.CREATE_ANNOTATIONS) && (
            <button>Add Annotation</button>
          )}
          {authService.hasPermission(user, Permission.CREATE_COMMENTS) && (
            <button>Add Comment</button>
          )}
        </div>
      )}
    </div>
  );
}

// Example 4: Creating Time-Limited Share Links
export function ShareLinkExample({ modelId }: { modelId: string }) {
  const [shareLink, setShareLink] = useState<ShareLink | null>(null);
  const [loading, setLoading] = useState(false);

  const createShareLink = async () => {
    setLoading(true);
    try {
      const link = await sharingService.createShareLink({
        modelId,
        expiresIn: 3600, // 1 hour
        permissions: [Permission.VIEW_MODELS, Permission.VIEW_ANNOTATIONS],
        maxUses: 10 // Optional: limit to 10 uses
      });
      
      setShareLink(link);
      
      // Get the full share URL
      const shareUrl = sharingService.createShareUrl(link.token);
      console.log('Share URL:', shareUrl);
      
    } catch (err) {
      console.error('Failed to create share link:', err);
    } finally {
      setLoading(false);
    }
  };

  const deactivateLink = async () => {
    if (!shareLink) return;
    
    try {
      await sharingService.deactivateShareLink(shareLink.id);
      setShareLink(null);
    } catch (err) {
      console.error('Failed to deactivate link:', err);
    }
  };

  if (shareLink) {
    return (
      <div>
        <p>Share Link Created!</p>
        <input 
          type="text" 
          value={sharingService.createShareUrl(shareLink.token)}
          readOnly
          style={{ width: '100%' }}
        />
        <p>Expires: {new Date(shareLink.expiresAt).toLocaleString()}</p>
        <p>Uses: {shareLink.currentUses} / {shareLink.maxUses || 'Unlimited'}</p>
        <button onClick={deactivateLink}>Deactivate Link</button>
      </div>
    );
  }

  return (
    <button onClick={createShareLink} disabled={loading}>
      {loading ? 'Creating...' : 'Create Share Link'}
    </button>
  );
}

// Example 5: Session Management
export function SessionManagementExample() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    loadUserAndSessions();
  }, []);

  const loadUserAndSessions = async () => {
    const currentUser = await authService.getCurrentUser();
    if (currentUser) {
      setUser(currentUser);
      const userSessions = await sessionService.getUserSessions(currentUser.id);
      setSessions(userSessions);
    }
  };

  const terminateSession = async (sessionId: string) => {
    try {
      await sessionService.terminateSession(sessionId);
      await loadUserAndSessions();
    } catch (err) {
      console.error('Failed to terminate session:', err);
    }
  };

  const terminateAllOtherSessions = async () => {
    if (!user) return;
    
    try {
      await sessionService.terminateAllOtherSessions(user.id);
      await loadUserAndSessions();
    } catch (err) {
      console.error('Failed to terminate sessions:', err);
    }
  };

  return (
    <div>
      <h3>Active Sessions</h3>
      {sessions.map(session => (
        <div key={session.id} style={{ marginBottom: '10px', padding: '10px', border: '1px solid #ccc' }}>
          <p>Device: {session.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'}</p>
          <p>IP: {session.ipAddress}</p>
          <p>Last Activity: {new Date(session.lastActivityAt).toLocaleString()}</p>
          <button onClick={() => terminateSession(session.id)}>
            End Session
          </button>
        </div>
      ))}
      
      {sessions.length > 1 && (
        <button onClick={terminateAllOtherSessions}>
          End All Other Sessions
        </button>
      )}
    </div>
  );
}

// Example 6: Role Management (Admin Only)
export function RoleManagementExample() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const allUsers = await rbacService.getAllUsers();
      setUsers(allUsers);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateUserRole = async (userId: string, newRole: UserRole) => {
    try {
      await rbacService.updateUserRole(userId, newRole);
      await loadUsers();
    } catch (err) {
      console.error('Failed to update role:', err);
    }
  };

  const toggleUserStatus = async (userId: string, isActive: boolean) => {
    try {
      await rbacService.setUserActiveStatus(userId, isActive);
      await loadUsers();
    } catch (err) {
      console.error('Failed to update user status:', err);
    }
  };

  if (loading) return <div>Loading users...</div>;

  return (
    <div>
      <h3>User Management</h3>
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Name</th>
            <th>Role</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map(user => (
            <tr key={user.id}>
              <td>{user.email}</td>
              <td>{user.firstName} {user.lastName}</td>
              <td>
                <select 
                  value={user.role}
                  onChange={(e) => updateUserRole(user.id, e.target.value as UserRole)}
                >
                  <option value={UserRole.VIEWER}>Viewer</option>
                  <option value={UserRole.COLLABORATOR}>Collaborator</option>
                  <option value={UserRole.ADMINISTRATOR}>Administrator</option>
                </select>
              </td>
              <td>{user.isActive ? 'Active' : 'Inactive'}</td>
              <td>
                <button onClick={() => toggleUserStatus(user.id, !user.isActive)}>
                  {user.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Example 7: Auth State Listener
export function AuthStateListenerExample() {
  const [authState, setAuthState] = useState<string>('unknown');

  useEffect(() => {
    // Listen for auth state changes
    const handleAuthStateChange = (event: any) => {
      const { event: authEvent, session } = event.detail;
      setAuthState(authEvent);
      
      switch (authEvent) {
        case 'SIGNED_IN':
          console.log('User signed in');
          break;
        case 'SIGNED_OUT':
          console.log('User signed out');
          break;
        case 'TOKEN_REFRESHED':
          console.log('Token refreshed');
          break;
        case 'USER_UPDATED':
          console.log('User profile updated');
          break;
      }
    };

    // Listen for session expiry
    const handleSessionExpired = () => {
      alert('Your session has expired. Please log in again.');
      window.location.href = '/login';
    };

    // Listen for token refresh failures
    const handleTokenRefreshFailed = () => {
      console.error('Token refresh failed');
    };

    window.addEventListener('auth:state-change', handleAuthStateChange);
    window.addEventListener('auth:session-expired', handleSessionExpired);
    window.addEventListener('auth:token-refresh-failed', handleTokenRefreshFailed);

    return () => {
      window.removeEventListener('auth:state-change', handleAuthStateChange);
      window.removeEventListener('auth:session-expired', handleSessionExpired);
      window.removeEventListener('auth:token-refresh-failed', handleTokenRefreshFailed);
    };
  }, []);

  return (
    <div>
      <p>Current Auth State: {authState}</p>
    </div>
  );
}