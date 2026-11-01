CREATE INDEX "applications_updated_at_idx" ON "applications" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "applications_status_updated_at_idx" ON "applications" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "applications_job_id_idx" ON "applications" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "feed_jobs_status_score_idx" ON "feed_jobs" USING btree ("status","score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feed_jobs_status_last_seen_idx" ON "feed_jobs" USING btree ("status","last_seen_at");--> statement-breakpoint
CREATE INDEX "resumes_updated_at_idx" ON "resumes" USING btree ("updated_at");