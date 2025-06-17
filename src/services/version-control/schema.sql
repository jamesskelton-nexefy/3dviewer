-- Version Control Database Schema for 3D Model Viewer
-- This schema extends the existing database with version control tables

-- Model versions table
CREATE TABLE IF NOT EXISTS public.model_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
    version TEXT NOT NULL, -- Semantic version: major.minor.patch
    parent_version_id UUID REFERENCES public.model_versions(id),
    branch_name TEXT NOT NULL DEFAULT 'main',
    commit_message TEXT NOT NULL,
    commit_hash TEXT NOT NULL,
    author_id UUID NOT NULL REFERENCES public.users(id),
    author_name TEXT NOT NULL,
    author_email TEXT NOT NULL,
    storage_path TEXT NOT NULL, -- Path in Supabase Storage
    file_size BIGINT NOT NULL,
    checksum TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'archived')),
    metadata JSONB NOT NULL DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(model_id, version, branch_name)
);

-- Branches table
CREATE TABLE IF NOT EXISTS public.branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_protected BOOLEAN DEFAULT false,
    is_default BOOLEAN DEFAULT false,
    head_version_id UUID REFERENCES public.model_versions(id),
    base_version_id UUID REFERENCES public.model_versions(id),
    created_by UUID NOT NULL REFERENCES public.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    UNIQUE(model_id, name)
);

-- Merge requests table
CREATE TABLE IF NOT EXISTS public.merge_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
    source_branch_id UUID NOT NULL REFERENCES public.branches(id),
    target_branch_id UUID NOT NULL REFERENCES public.branches(id),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'merged', 'closed', 'conflict')),
    author_id UUID NOT NULL REFERENCES public.users(id),
    merged_by UUID REFERENCES public.users(id),
    merged_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Merge request reviewers
CREATE TABLE IF NOT EXISTS public.merge_request_reviewers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merge_request_id UUID NOT NULL REFERENCES public.merge_requests(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'commented')),
    comments TEXT,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(merge_request_id, user_id)
);

-- Merge conflicts table
CREATE TABLE IF NOT EXISTS public.merge_conflicts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merge_request_id UUID NOT NULL REFERENCES public.merge_requests(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('geometry_overlap', 'material_conflict', 'texture_conflict', 'metadata_conflict', 'annotation_conflict', 'transform_conflict')),
    path TEXT NOT NULL,
    description TEXT NOT NULL,
    source_value JSONB,
    target_value JSONB,
    resolution JSONB, -- Stores ConflictResolution object
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Approval workflows table
CREATE TABLE IF NOT EXISTS public.approval_workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
    version_id UUID NOT NULL REFERENCES public.model_versions(id) ON DELETE CASCADE,
    required_approvers UUID[] NOT NULL,
    approvals JSONB NOT NULL DEFAULT '[]', -- Array of Approval objects
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    deadline TIMESTAMP WITH TIME ZONE,
    auto_approve_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Version tags table
CREATE TABLE IF NOT EXISTS public.version_tags (
    name TEXT NOT NULL,
    version_id UUID NOT NULL REFERENCES public.model_versions(id) ON DELETE CASCADE,
    description TEXT,
    created_by UUID NOT NULL REFERENCES public.users(id),
    is_release BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(name, version_id)
);

-- Comments table (for merge requests and versions)
CREATE TABLE IF NOT EXISTS public.version_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    target_type TEXT NOT NULL CHECK (target_type IN ('version', 'merge_request')),
    target_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES public.users(id),
    content TEXT NOT NULL,
    parent_id UUID REFERENCES public.version_comments(id), -- For replies
    is_resolved BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Version downloads tracking
CREATE TABLE IF NOT EXISTS public.version_downloads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    version_id UUID NOT NULL REFERENCES public.model_versions(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id),
    ip_address TEXT,
    user_agent TEXT,
    downloaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_model_versions_model_id ON public.model_versions(model_id);
CREATE INDEX idx_model_versions_branch ON public.model_versions(branch_name);
CREATE INDEX idx_model_versions_status ON public.model_versions(status);
CREATE INDEX idx_model_versions_author ON public.model_versions(author_id);
CREATE INDEX idx_model_versions_created ON public.model_versions(created_at);

CREATE INDEX idx_branches_model_id ON public.branches(model_id);
CREATE INDEX idx_branches_created_by ON public.branches(created_by);

CREATE INDEX idx_merge_requests_model_id ON public.merge_requests(model_id);
CREATE INDEX idx_merge_requests_author ON public.merge_requests(author_id);
CREATE INDEX idx_merge_requests_status ON public.merge_requests(status);

CREATE INDEX idx_approval_workflows_model_id ON public.approval_workflows(model_id);
CREATE INDEX idx_approval_workflows_version_id ON public.approval_workflows(version_id);
CREATE INDEX idx_approval_workflows_status ON public.approval_workflows(status);

CREATE INDEX idx_version_comments_target ON public.version_comments(target_type, target_id);
CREATE INDEX idx_version_comments_user ON public.version_comments(user_id);

-- Row Level Security Policies

-- Model versions policies
CREATE POLICY "Users can view approved versions" ON public.model_versions
    FOR SELECT USING (
        status = 'approved' OR
        author_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.models 
            WHERE id = model_id AND (owner_id = auth.uid() OR is_public = true)
        )
    );

CREATE POLICY "Users can create versions for their models" ON public.model_versions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.models 
            WHERE id = model_id AND owner_id = auth.uid()
        )
    );

CREATE POLICY "Users can update their own versions" ON public.model_versions
    FOR UPDATE USING (author_id = auth.uid());

-- Branches policies
CREATE POLICY "Users can view branches for accessible models" ON public.branches
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.models 
            WHERE id = model_id AND (owner_id = auth.uid() OR is_public = true)
        )
    );

CREATE POLICY "Users can create branches for their models" ON public.branches
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.models 
            WHERE id = model_id AND owner_id = auth.uid()
        )
    );

CREATE POLICY "Branch creators can update non-protected branches" ON public.branches
    FOR UPDATE USING (created_by = auth.uid() AND is_protected = false);

-- Merge requests policies
CREATE POLICY "Users can view merge requests for accessible models" ON public.merge_requests
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.models 
            WHERE id = model_id AND (owner_id = auth.uid() OR is_public = true)
        ) OR author_id = auth.uid()
    );

CREATE POLICY "Users can create merge requests" ON public.merge_requests
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Merge request authors can update their requests" ON public.merge_requests
    FOR UPDATE USING (author_id = auth.uid() AND status = 'open');

-- Approval workflows policies
CREATE POLICY "Users can view workflows they're involved in" ON public.approval_workflows
    FOR SELECT USING (
        auth.uid() = ANY(required_approvers) OR
        EXISTS (
            SELECT 1 FROM public.model_versions 
            WHERE id = version_id AND author_id = auth.uid()
        )
    );

-- Enable RLS on all tables
ALTER TABLE public.model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merge_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merge_request_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merge_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.version_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.version_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.version_downloads ENABLE ROW LEVEL SECURITY;

-- Functions

-- Function to get version history graph
CREATE OR REPLACE FUNCTION get_version_graph(p_model_id UUID, p_branch_name TEXT DEFAULT NULL)
RETURNS TABLE(
    version_id UUID,
    parent_id UUID,
    version TEXT,
    branch TEXT,
    author TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    commit_message TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE version_tree AS (
        -- Base case: versions without parents
        SELECT 
            v.id,
            v.parent_version_id,
            v.version,
            v.branch_name,
            v.author_name,
            v.created_at,
            v.commit_message
        FROM public.model_versions v
        WHERE v.model_id = p_model_id 
            AND v.parent_version_id IS NULL
            AND (p_branch_name IS NULL OR v.branch_name = p_branch_name)
        
        UNION ALL
        
        -- Recursive case
        SELECT 
            v.id,
            v.parent_version_id,
            v.version,
            v.branch_name,
            v.author_name,
            v.created_at,
            v.commit_message
        FROM public.model_versions v
        INNER JOIN version_tree vt ON v.parent_version_id = vt.id
        WHERE v.model_id = p_model_id
            AND (p_branch_name IS NULL OR v.branch_name = p_branch_name)
    )
    SELECT * FROM version_tree
    ORDER BY created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to check if user can merge branches
CREATE OR REPLACE FUNCTION can_merge_branches(p_user_id UUID, p_merge_request_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_model_owner UUID;
    v_is_reviewer BOOLEAN;
BEGIN
    -- Check if user is model owner
    SELECT m.owner_id INTO v_model_owner
    FROM public.merge_requests mr
    JOIN public.models m ON m.id = mr.model_id
    WHERE mr.id = p_merge_request_id;
    
    IF v_model_owner = p_user_id THEN
        RETURN TRUE;
    END IF;
    
    -- Check if user is an approved reviewer
    SELECT EXISTS(
        SELECT 1 
        FROM public.merge_request_reviewers 
        WHERE merge_request_id = p_merge_request_id 
            AND user_id = p_user_id 
            AND status = 'approved'
    ) INTO v_is_reviewer;
    
    RETURN v_is_reviewer;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update branch metadata
CREATE OR REPLACE FUNCTION update_branch_metadata()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Update branch last activity
        UPDATE public.branches
        SET 
            metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{lastActivity}',
                to_jsonb(NEW.created_at)
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = (
            SELECT b.id 
            FROM public.branches b 
            WHERE b.model_id = NEW.model_id 
                AND b.name = NEW.branch_name
        );
        
        -- Add contributor if not already present
        UPDATE public.branches
        SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{contributors}',
            COALESCE(metadata->'contributors', '[]'::jsonb) || to_jsonb(NEW.author_id)
        )
        WHERE id = (
            SELECT b.id 
            FROM public.branches b 
            WHERE b.model_id = NEW.model_id 
                AND b.name = NEW.branch_name
        )
        AND NOT (metadata->'contributors' ? NEW.author_id::text);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_branch_on_version
    AFTER INSERT ON public.model_versions
    FOR EACH ROW EXECUTE FUNCTION update_branch_metadata();

-- Grants
GRANT ALL ON public.model_versions TO authenticated;
GRANT ALL ON public.branches TO authenticated;
GRANT ALL ON public.merge_requests TO authenticated;
GRANT ALL ON public.merge_request_reviewers TO authenticated;
GRANT ALL ON public.merge_conflicts TO authenticated;
GRANT ALL ON public.approval_workflows TO authenticated;
GRANT ALL ON public.version_tags TO authenticated;
GRANT ALL ON public.version_comments TO authenticated;
GRANT ALL ON public.version_downloads TO authenticated;