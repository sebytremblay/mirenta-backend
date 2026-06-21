-- Repoint the product-profile vertical default from the employee-service id to the
-- neutral generic id. This supersedes migration 0004's default: an insert that
-- omits a vertical now lands on the horizontal generic spec, which carries no
-- industry assumption, rather than the HR/ITSM employee-service spec (the leak a
-- self-sell run surfaced when an un-configured profile researched a Salesforce
-- prospect through an HR/ITSM lens). A customer that sells into a specific vertical
-- declares it explicitly. See DECISIONS.md (default vertical change).
--
-- The column stays not null. Existing rows are unaffected: a default applies only
-- to new inserts that omit the column, so any profile already carrying
-- 'salesforce_employee_service' keeps it.

alter table product_profiles
  alter column vertical set default 'generic';
