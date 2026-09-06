-- Appendix B: "rule enforced in the app and by a trigger:
-- evaluator_id <> claimant and <> proposer of the bounty".
-- The second attestor is held to the same rule (PRD §7.5 anti-gaming).
CREATE OR REPLACE FUNCTION evaluations_check_independence() RETURNS trigger AS $$
DECLARE
  v_claimant text;
  v_proposer text;
  v_proposer_kind proposal_author;
BEGIN
  SELECT c.user_id, p.author_id, p.author_kind
    INTO v_claimant, v_proposer, v_proposer_kind
    FROM submissions s
    JOIN claims c ON c.id = s.claim_id
    JOIN bounties b ON b.id = c.bounty_id
    LEFT JOIN proposals p ON p.id = b.proposal_id
   WHERE s.id = NEW.submission_id;

  IF NEW.evaluator_id IS NOT NULL AND v_claimant IS NOT NULL AND NEW.evaluator_id = v_claimant THEN
    RAISE EXCEPTION 'evaluator % may not evaluate their own claim', NEW.evaluator_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'evaluations_evaluator_not_claimant';
  END IF;

  IF NEW.evaluator_id IS NOT NULL AND v_proposer_kind = 'human' AND v_proposer IS NOT NULL
     AND NEW.evaluator_id = v_proposer THEN
    RAISE EXCEPTION 'evaluator % may not evaluate a bounty they proposed', NEW.evaluator_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'evaluations_evaluator_not_proposer';
  END IF;

  IF NEW.second_attestation_by IS NOT NULL AND (
       NEW.second_attestation_by = NEW.evaluator_id
    OR (v_claimant IS NOT NULL AND NEW.second_attestation_by = v_claimant)
    OR (v_proposer_kind = 'human' AND v_proposer IS NOT NULL AND NEW.second_attestation_by = v_proposer)
  ) THEN
    RAISE EXCEPTION 'second attestor % is not independent', NEW.second_attestation_by
      USING ERRCODE = 'check_violation', CONSTRAINT = 'evaluations_second_attestor_independent';
  END IF;

  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS evaluations_independence ON evaluations;
--> statement-breakpoint
CREATE TRIGGER evaluations_independence
  BEFORE INSERT OR UPDATE ON evaluations
  FOR EACH ROW EXECUTE FUNCTION evaluations_check_independence();
