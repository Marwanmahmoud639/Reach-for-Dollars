
CREATE TABLE IF NOT EXISTS public.team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  email text NOT NULL,
  role app_role NOT NULL DEFAULT 'agent',
  invited_by uuid,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE (team_id, email)
);

GRANT SELECT ON public.team_invites TO authenticated;
GRANT ALL ON public.team_invites TO service_role;

ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team admins/managers view invites"
  ON public.team_invites FOR SELECT TO authenticated
  USING (
    team_id = public.get_user_team(auth.uid())
    AND (
      public.has_team_role(auth.uid(), team_id, 'admin'::app_role)
      OR public.has_team_role(auth.uid(), team_id, 'manager'::app_role)
    )
  );

CREATE POLICY "super admin full access team_invites"
  ON public.team_invites FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_team_invites_email ON public.team_invites (lower(email));

-- Update handle_new_user to honor invites
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  new_team_id uuid;
  user_plan plan_tier;
  user_contact_limit int;
  user_seat_limit int;
  invited_team uuid;
  invited_role_text text;
  invited_role app_role;
begin
  invited_team := nullif(new.raw_user_meta_data->>'invited_team_id','')::uuid;
  invited_role_text := new.raw_user_meta_data->>'invited_role';

  if invited_team is not null then
    -- Validate role text → enum, default to agent
    begin
      invited_role := coalesce(invited_role_text::app_role, 'agent'::app_role);
    exception when others then
      invited_role := 'agent'::app_role;
    end;

    insert into public.profiles (id, email, name, team_id)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name',''), invited_team);

    insert into public.user_roles (user_id, team_id, role)
    values (new.id, invited_team, invited_role)
    on conflict do nothing;

    update public.team_invites
       set status = 'accepted', accepted_at = now()
     where team_id = invited_team
       and lower(email) = lower(new.email)
       and status = 'pending';

    return new;
  end if;

  -- Default self-signup path: create team
  user_plan := coalesce((new.raw_user_meta_data->>'plan')::plan_tier, 'starter'::plan_tier);
  user_contact_limit := case user_plan
    when 'starter' then 5000
    when 'growth' then 25000
    when 'agency' then 1000000
  end;
  user_seat_limit := case user_plan
    when 'starter' then 1
    when 'growth' then 3
    when 'agency' then 10
  end;

  insert into public.teams (name, owner_id, plan, contact_limit, seat_limit)
  values (coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)) || '''s Team',
          new.id, user_plan, user_contact_limit, user_seat_limit)
  returning id into new_team_id;

  insert into public.profiles (id, email, name, team_id)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''), new_team_id);

  insert into public.user_roles (user_id, team_id, role) values (new.id, new_team_id, 'admin');

  insert into public.team_settings (team_id) values (new_team_id);

  insert into public.pipeline_stages (team_id, name, position, color) values
    (new_team_id, 'New Lead', 0, '#64748B'),
    (new_team_id, 'Contacted (Email)', 1, '#2563EB'),
    (new_team_id, 'Contacted (SMS)', 2, '#10B981'),
    (new_team_id, 'Contacted (Social)', 3, '#8B5CF6'),
    (new_team_id, 'Responded', 4, '#F59E0B'),
    (new_team_id, 'Qualified', 5, '#EF4444'),
    (new_team_id, 'Closed', 6, '#22C55E'),
    (new_team_id, 'Not Interested', 7, '#475569');

  return new;
end;
$function$;
