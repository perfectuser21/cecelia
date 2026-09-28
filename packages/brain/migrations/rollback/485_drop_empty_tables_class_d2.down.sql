-- 回滚 485：按 2026-09-29 生产 pg_dump -s 原样重建 2 张表（空表）。看板代码需一并 revert 本 PR。
BEGIN;
\restrict EyOVZb3TROX7qAke3a8VbikbZfGJ9sl2nd0PEYCccT0XLkd9ZMpYVciFIsjk8Dq

CREATE TABLE public.life_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(200) NOT NULL,
    date date,
    event_type character varying(50),
    location character varying(200),
    people text[],
    description text,
    area_id uuid,
    capture_atom_id uuid,
    owner character varying(20) DEFAULT 'user'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_annotations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type character varying(32) NOT NULL,
    entity_id uuid NOT NULL,
    field_path text,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_annotations_entity_type_check CHECK (((entity_type)::text = ANY (ARRAY[('dev_record'::character varying)::text, ('decision'::character varying)::text, ('design_doc'::character varying)::text])))
);

ALTER TABLE ONLY public.life_events
    ADD CONSTRAINT life_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_annotations
    ADD CONSTRAINT user_annotations_pkey PRIMARY KEY (id);

CREATE INDEX idx_life_events_area_id ON public.life_events USING btree (area_id);

CREATE INDEX idx_life_events_date ON public.life_events USING btree (date DESC);

CREATE INDEX idx_life_events_event_type ON public.life_events USING btree (event_type);

CREATE INDEX idx_user_annotations_entity ON public.user_annotations USING btree (entity_type, entity_id);

ALTER TABLE ONLY public.life_events
    ADD CONSTRAINT life_events_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.life_events
    ADD CONSTRAINT life_events_capture_atom_id_fkey FOREIGN KEY (capture_atom_id) REFERENCES public.capture_atoms(id) ON DELETE SET NULL;

\unrestrict EyOVZb3TROX7qAke3a8VbikbZfGJ9sl2nd0PEYCccT0XLkd9ZMpYVciFIsjk8Dq

DELETE FROM schema_version WHERE version = '485';
COMMIT;
