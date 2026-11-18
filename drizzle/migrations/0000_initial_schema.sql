CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"user_name" varchar(255) NOT NULL,
	"user_role" varchar(50) NOT NULL,
	"project_id" uuid,
	"entity_name" varchar(255) NOT NULL,
	"field_changed" varchar(255) NOT NULL,
	"old_value" text NOT NULL,
	"new_value" text NOT NULL,
	"justification" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carbon_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"scope" varchar(20) NOT NULL,
	"lifecycle_phase" varchar(100) NOT NULL,
	"emissions_per_unit_tonne_co2e" numeric(10, 4) NOT NULL,
	"total_lifecycle_emissions" numeric(12, 3) NOT NULL,
	"emission_factor_source" varchar(255) NOT NULL,
	"confidence_level" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carbon_items_scope_check" CHECK ("carbon_items"."scope" IN ('Scope 1', 'Scope 2', 'Scope 3 Amont', 'Scope 3 Aval')),
	CONSTRAINT "carbon_items_confidence_level_check" CHECK ("carbon_items"."confidence_level" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "cost_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"category" varchar(100) NOT NULL,
	"label" varchar(255) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"unit" varchar(50) NOT NULL,
	"source_name" varchar(255) NOT NULL,
	"source_type" varchar(50) NOT NULL,
	"confidence_level" integer NOT NULL,
	"is_recurring_yearly" boolean DEFAULT false NOT NULL,
	"calculation_formula" text,
	"explanation_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_items_source_type_check" CHECK ("cost_items"."source_type" IN ('verifiee', 'calculee', 'estimee')),
	CONSTRAINT "cost_items_confidence_level_check" CHECK ("cost_items"."confidence_level" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"legal_registration_number" varchar(50),
	"country_code" varchar(2) DEFAULT 'FR' NOT NULL,
	"default_currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category" varchar(100) NOT NULL,
	"company_name" varchar(255) NOT NULL,
	"budget_cap" numeric(14, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"planned_volume" integer NOT NULL,
	"unit_name" varchar(50) NOT NULL,
	"horizon_years" integer NOT NULL,
	"status" varchar(50) DEFAULT 'Brouillon' NOT NULL,
	"discount_rate" numeric(6, 4) NOT NULL,
	"energy_inflation_rate" numeric(6, 4) NOT NULL,
	"general_inflation_rate" numeric(6, 4) NOT NULL,
	"carbon_price_per_tonne" numeric(10, 2) DEFAULT '120.00' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_projects_org_ref" UNIQUE("organization_id","reference"),
	CONSTRAINT "projects_budget_cap_check" CHECK ("projects"."budget_cap" > 0),
	CONSTRAINT "projects_planned_volume_check" CHECK ("projects"."planned_volume" > 0),
	CONSTRAINT "projects_horizon_years_check" CHECK ("projects"."horizon_years" BETWEEN 1 AND 15),
	CONSTRAINT "projects_status_check" CHECK ("projects"."status" IN ('brouillon', 'collecte_offres', 'analyse', 'validation_finance', 'validation_achats', 'decision', 'termine', 'archive', 'Brouillon', 'Cahier des charges', 'Consultation', 'Analyse', 'Validation Finance', 'Validation Achats', 'Décision', 'Contractualisé', 'En exploitation', 'Archivé', 'Terminé / Arbitré')),
	CONSTRAINT "projects_discount_rate_check" CHECK ("projects"."discount_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reference_benchmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" varchar(100) NOT NULL,
	"source" varchar(255) NOT NULL,
	"value" numeric(14, 4) NOT NULL,
	"unit" varchar(50) NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"confidence_score" integer NOT NULL,
	"last_audit_date" timestamp with time zone NOT NULL,
	"legal_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_benchmarks_org_name" UNIQUE("organization_id","name"),
	CONSTRAINT "reference_benchmarks_category_check" CHECK ("reference_benchmarks"."category" IN ('energie', 'carbone', 'financier', 'social', 'dechets', 'wacc', 'pollution_locale', 'main_d_oeuvre', 'taux_interet')),
	CONSTRAINT "reference_benchmarks_confidence_score_check" CHECK ("reference_benchmarks"."confidence_score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "risk_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"description" text NOT NULL,
	"probability" numeric(5, 4) NOT NULL,
	"financial_impact" numeric(14, 2) NOT NULL,
	"source_evidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_items_probability_check" CHECK ("risk_items"."probability" BETWEEN 0 AND 1),
	CONSTRAINT "risk_items_financial_impact_check" CHECK ("risk_items"."financial_impact" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"offer_reference" varchar(100) NOT NULL,
	"apparent_total" numeric(14, 2) NOT NULL,
	"is_responsible_candidate" boolean DEFAULT false NOT NULL,
	"economic_tco_nominal" numeric(14, 2),
	"lifecycle_cost_lcc" numeric(14, 2),
	"total_lifecycle_co2e_tonnes" numeric(10, 3),
	"monetized_carbon_total" numeric(14, 2),
	"risk_exposition_total" numeric(14, 2),
	"total_comprehensive_tco" numeric(14, 2),
	"confidence_score" integer DEFAULT 85 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_offers_project_ref" UNIQUE("project_id","offer_reference"),
	CONSTRAINT "supplier_offers_apparent_total_check" CHECK ("supplier_offers"."apparent_total" >= 0),
	CONSTRAINT "supplier_offers_confidence_score_check" CHECK ("supplier_offers"."confidence_score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"incoterm" varchar(10) DEFAULT 'DDP' NOT NULL,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"standard_lead_time_days" integer NOT NULL,
	"minimum_order_quantity" integer DEFAULT 1 NOT NULL,
	"warranty_months" integer DEFAULT 24 NOT NULL,
	"historical_defect_rate" numeric(6, 4) DEFAULT '0.0200' NOT NULL,
	"esg_score" integer DEFAULT 70 NOT NULL,
	"has_verified_environmental_data" boolean DEFAULT false NOT NULL,
	"environmental_data_source" text,
	"certifications" text[],
	"data_quality_score" integer DEFAULT 85 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_suppliers_org_name" UNIQUE("organization_id","name"),
	CONSTRAINT "suppliers_esg_score_check" CHECK ("suppliers"."esg_score" BETWEEN 0 AND 100),
	CONSTRAINT "suppliers_data_quality_score_check" CHECK ("suppliers"."data_quality_score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"clerk_id" varchar(255),
	"role" varchar(50) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_users_org_email" UNIQUE("organization_id","email"),
	CONSTRAINT "users_role_check" CHECK ("users"."role" IN ('directeur_achats', 'acheteur', 'finance_controleur', 'rse_esg', 'direction_generale', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carbon_items" ADD CONSTRAINT "carbon_items_offer_id_supplier_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."supplier_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_offer_id_supplier_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."supplier_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_benchmarks" ADD CONSTRAINT "reference_benchmarks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_items" ADD CONSTRAINT "risk_items_offer_id_supplier_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."supplier_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD CONSTRAINT "supplier_offers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD CONSTRAINT "supplier_offers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_org_timestamp" ON "audit_logs" USING btree ("organization_id","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_audit_logs_project" ON "audit_logs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_carbon_items_offer" ON "carbon_items" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "idx_cost_items_offer" ON "cost_items" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "idx_cost_items_category" ON "cost_items" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_organizations_name" ON "organizations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_projects_org" ON "projects" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_projects_status" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_projects_category" ON "projects" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_benchmarks_org" ON "reference_benchmarks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_benchmarks_category" ON "reference_benchmarks" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_risk_items_offer" ON "risk_items" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "idx_offers_project" ON "supplier_offers" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_offers_supplier" ON "supplier_offers" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "idx_suppliers_org" ON "suppliers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_users_org" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_users_role" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_users_clerk_id" ON "users" USING btree ("clerk_id");--> statement-breakpoint
-- Custom SQL not represented by Drizzle's declarative schema API.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trigger_update_organizations_updated_at
 BEFORE UPDATE ON organizations
 FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
--> statement-breakpoint
CREATE TRIGGER trigger_update_users_updated_at
 BEFORE UPDATE ON users
 FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
--> statement-breakpoint
CREATE TRIGGER trigger_update_projects_updated_at
 BEFORE UPDATE ON projects
 FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
--> statement-breakpoint
CREATE TRIGGER trigger_update_suppliers_updated_at
 BEFORE UPDATE ON suppliers
 FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
--> statement-breakpoint
CREATE TRIGGER trigger_update_supplier_offers_updated_at
 BEFORE UPDATE ON supplier_offers
 FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
--> statement-breakpoint
CREATE TRIGGER trigger_update_reference_benchmarks_updated_at
 BEFORE UPDATE ON reference_benchmarks
 FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
