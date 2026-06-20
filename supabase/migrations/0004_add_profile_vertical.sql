-- Add the customer's declared vertical to the product profile.
-- The pipeline resolves this id at runtime to the VerticalSpec (src/verticals)
-- that drives research and rendering for the customer's pages. The generic core
-- stays vertical-neutral; registering a new vertical is a data-only add in code.
--
-- The column defaults to the employee-service id so existing rows and any insert
-- that omits a vertical keep the MVP's first registered spec.

alter table product_profiles
  add column if not exists vertical text not null default 'salesforce_employee_service';
