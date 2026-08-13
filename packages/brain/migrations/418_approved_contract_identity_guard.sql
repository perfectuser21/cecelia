BEGIN;

CREATE OR REPLACE FUNCTION reject_approved_contract_identity_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('approved', 'superseded') THEN
    RAISE EXCEPTION 'approved contract identity is immutable';
  END IF;
  IF OLD.status IN ('approved', 'superseded')
     AND (
       NEW.version IS DISTINCT FROM OLD.version
       OR NEW.branch IS DISTINCT FROM OLD.branch
       OR NEW.prd_content IS DISTINCT FROM OLD.prd_content
       OR NEW.contract_content IS DISTINCT FROM OLD.contract_content
     ) THEN
    RAISE EXCEPTION 'approved contract identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS approved_contract_identity_immutable
  ON initiative_contracts;
CREATE TRIGGER approved_contract_identity_immutable
BEFORE UPDATE OR DELETE ON initiative_contracts
FOR EACH ROW EXECUTE FUNCTION reject_approved_contract_identity_mutation();

INSERT INTO schema_version (version, description, applied_at)
VALUES ('418', 'Protect approved contract identity and core projections', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
