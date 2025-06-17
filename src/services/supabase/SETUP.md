# Supabase Authentication Setup Guide

This guide will help you set up Supabase authentication for the 3D Viewer application.

## Prerequisites

1. A Supabase account (create one at https://supabase.com)
2. A Supabase project

## Setup Steps

### 1. Create a Supabase Project

1. Log in to your Supabase dashboard
2. Click "New Project"
3. Fill in the project details:
   - Name: "3D Viewer App" (or your preferred name)
   - Database Password: Choose a strong password
   - Region: Select the closest region to your users

### 2. Get Your API Keys

1. Go to Settings → API in your Supabase dashboard
2. Copy the following values:
   - `Project URL` → This is your `VITE_SUPABASE_URL`
   - `anon/public key` → This is your `VITE_SUPABASE_ANON_KEY`

### 3. Configure Environment Variables

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Update the `.env` file with your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=your_project_url_here
   VITE_SUPABASE_ANON_KEY=your_anon_key_here
   ```

### 4. Set Up Database Schema

1. Go to the SQL Editor in your Supabase dashboard
2. Copy the contents of `src/services/supabase/schema.sql`
3. Paste and run the SQL in the editor
4. This will create all necessary tables and security policies

### 5. Configure Authentication Settings

1. Go to Authentication → Settings in Supabase
2. Configure the following:

#### Email Settings
- Enable Email Confirmations: ON
- Confirm Email Template: Customize as needed
- Password Recovery Template: Customize as needed

#### JWT Settings
- JWT Expiry: 900 (15 minutes)
- This matches our `ACCESS_TOKEN_EXPIRY` setting

#### Security Settings
- Enable Row Level Security: Already handled in schema
- Enable Email Confirmations: ON
- Disable Sign Ups: OFF (unless you want to restrict registration)

### 6. Set Up Email Templates (Optional)

Customize email templates in Authentication → Email Templates:

1. **Confirmation Email**
   ```html
   <h2>Confirm your email</h2>
   <p>Thank you for signing up for 3D Viewer!</p>
   <p>Please click the link below to confirm your email:</p>
   <a href="{{ .ConfirmationURL }}">Confirm Email</a>
   ```

2. **Password Reset Email**
   ```html
   <h2>Reset your password</h2>
   <p>Click the link below to reset your password:</p>
   <a href="{{ .ConfirmationURL }}">Reset Password</a>
   <p>This link will expire in 24 hours.</p>
   ```

### 7. Configure Storage (Optional)

If you plan to store 3D models in Supabase Storage:

1. Go to Storage in your dashboard
2. Create a new bucket called "models"
3. Set the bucket to private
4. Configure CORS if needed for your domain

### 8. Set Up Scheduled Jobs (Production)

For production, set up cron jobs to clean up expired sessions and share links:

1. Use Supabase Edge Functions or external cron service
2. Run these functions periodically:
   - `cleanup_expired_sessions()` - Every hour
   - `cleanup_expired_share_links()` - Every hour

## Testing the Setup

1. Start your development server:
   ```bash
   npm run dev
   ```

2. Test the authentication flow:
   - Register a new user
   - Check email for confirmation
   - Log in with credentials
   - Test password reset

## Security Considerations

### 1. HttpOnly Cookies (Production)

In production, implement a backend service to handle refresh tokens as HttpOnly cookies:

```javascript
// Example Express.js endpoint
app.post('/api/auth/refresh', async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  
  // Validate and refresh token with Supabase
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken
  });
  
  if (error) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
  
  // Set new refresh token as HttpOnly cookie
  res.cookie('refreshToken', data.session.refresh_token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  });
  
  // Return access token
  res.json({ accessToken: data.session.access_token });
});
```

### 2. CORS Configuration

Configure CORS in your Supabase project:

1. Go to Settings → API
2. Add your allowed origins:
   - `http://localhost:5173` (development)
   - `https://yourdomain.com` (production)

### 3. Rate Limiting

Enable rate limiting in Supabase:

1. Go to Settings → Database
2. Configure rate limits for authentication endpoints

## Troubleshooting

### Common Issues

1. **"Missing Supabase environment variables" error**
   - Ensure `.env` file exists and contains valid values
   - Restart the development server after updating `.env`

2. **Authentication fails with "Invalid credentials"**
   - Check that the user exists in the database
   - Ensure email is confirmed if email confirmations are enabled

3. **Session expires too quickly**
   - Check JWT expiry settings in Supabase match your app config
   - Ensure token refresh is working properly

4. **RLS policies blocking access**
   - Review the SQL schema and ensure policies are correct
   - Check user roles and permissions

### Debug Mode

Enable debug logging by adding to your `.env`:
```env
VITE_DEBUG=true
```

## Next Steps

1. Implement role-based UI components
2. Add session activity monitoring
3. Set up audit logging
4. Configure production deployment
5. Implement SSO providers (optional)

## Support

For issues specific to:
- Supabase: https://supabase.com/docs
- This implementation: Check the project's issue tracker