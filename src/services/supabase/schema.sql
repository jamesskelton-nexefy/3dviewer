-- Supabase Database Schema for 3D Viewer Application
-- This schema defines the tables needed for authentication, RBAC, and sharing features

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    avatar TEXT,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('administrator', 'collaborator', 'viewer')),
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for email lookups
CREATE INDEX idx_users_email ON public.users(email);
CREATE INDEX idx_users_role ON public.users(role);

-- Sessions table for tracking active sessions
CREATE TABLE IF NOT EXISTS public.sessions (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    user_agent TEXT,
    ip_address TEXT,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for session queries
CREATE INDEX idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX idx_sessions_active ON public.sessions(is_active);
CREATE INDEX idx_sessions_expires ON public.sessions(expires_at);

-- Share links table for time-limited sharing
CREATE TABLE IF NOT EXISTS public.share_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    permissions TEXT[] NOT NULL,
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    max_uses INTEGER,
    current_uses INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for share link queries
CREATE INDEX idx_share_links_token ON public.share_links(token);
CREATE INDEX idx_share_links_model_id ON public.share_links(model_id);
CREATE INDEX idx_share_links_created_by ON public.share_links(created_by);
CREATE INDEX idx_share_links_active ON public.share_links(is_active);
CREATE INDEX idx_share_links_expires ON public.share_links(expires_at);

-- Models table (for reference by share links)
CREATE TABLE IF NOT EXISTS public.models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    mime_type TEXT,
    owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    is_public BOOLEAN DEFAULT false,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for model queries
CREATE INDEX idx_models_owner_id ON public.models(owner_id);
CREATE INDEX idx_models_public ON public.models(is_public);

-- Audit log table for security tracking
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    details JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for audit log queries
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at);

-- Row Level Security (RLS) Policies

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Users table policies
CREATE POLICY "Users can view their own profile" ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Admins can view all users" ON public.users
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = auth.uid() AND role = 'administrator'
        )
    );

CREATE POLICY "Users can update their own profile" ON public.users
    FOR UPDATE USING (auth.uid() = id);

-- Sessions table policies
CREATE POLICY "Users can view their own sessions" ON public.sessions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own sessions" ON public.sessions
    FOR ALL USING (auth.uid() = user_id);

-- Share links table policies
CREATE POLICY "Users can view their own share links" ON public.share_links
    FOR SELECT USING (auth.uid() = created_by);

CREATE POLICY "Users can create share links for their models" ON public.share_links
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.models 
            WHERE id::text = model_id AND owner_id = auth.uid()
        )
    );

CREATE POLICY "Users can update their own share links" ON public.share_links
    FOR UPDATE USING (auth.uid() = created_by);

CREATE POLICY "Users can delete their own share links" ON public.share_links
    FOR DELETE USING (auth.uid() = created_by);

-- Models table policies
CREATE POLICY "Users can view their own models" ON public.models
    FOR SELECT USING (auth.uid() = owner_id OR is_public = true);

CREATE POLICY "Users can create models" ON public.models
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own models" ON public.models
    FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own models" ON public.models
    FOR DELETE USING (auth.uid() = owner_id);

-- Audit logs policies (insert only, view for admins)
CREATE POLICY "Anyone can create audit logs" ON public.audit_logs
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins can view all audit logs" ON public.audit_logs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = auth.uid() AND role = 'administrator'
        )
    );

-- Functions and Triggers

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update trigger to tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_models_updated_at BEFORE UPDATE ON public.models
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to clean up expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
    UPDATE public.sessions 
    SET is_active = false 
    WHERE expires_at < CURRENT_TIMESTAMP AND is_active = true;
END;
$$ language 'plpgsql';

-- Function to clean up expired share links
CREATE OR REPLACE FUNCTION cleanup_expired_share_links()
RETURNS void AS $$
BEGIN
    UPDATE public.share_links 
    SET is_active = false 
    WHERE expires_at < CURRENT_TIMESTAMP AND is_active = true;
END;
$$ language 'plpgsql';

-- Create a function to log user actions
CREATE OR REPLACE FUNCTION log_user_action(
    p_action TEXT,
    p_resource_type TEXT DEFAULT NULL,
    p_resource_id TEXT DEFAULT NULL,
    p_details JSONB DEFAULT NULL
)
RETURNS void AS $$
BEGIN
    INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, details)
    VALUES (auth.uid(), p_action, p_resource_type, p_resource_id, p_details);
END;
$$ language 'plpgsql';

-- Grant necessary permissions
GRANT ALL ON public.users TO authenticated;
GRANT ALL ON public.sessions TO authenticated;
GRANT ALL ON public.share_links TO authenticated;
GRANT ALL ON public.models TO authenticated;
GRANT INSERT ON public.audit_logs TO authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;