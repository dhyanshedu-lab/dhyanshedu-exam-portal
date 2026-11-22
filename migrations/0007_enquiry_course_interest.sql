-- Add the optional course selected on the public website enquiry form.
-- Existing enquiries remain valid and receive NULL.
ALTER TABLE enquiries ADD COLUMN course_interest TEXT;
