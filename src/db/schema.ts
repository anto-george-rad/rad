import {
  pgTable, text, integer, boolean, timestamp, jsonb, doublePrecision, date, uuid, index, uniqueIndex, pgEnum, serial,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['admin', 'manager', 'rep']);
export const stageTypeEnum = pgEnum('stage_type', ['open', 'won', 'lost']);
export const leadStatusEnum = pgEnum('lead_status', ['New', 'Contacted', 'Qualified', 'Unqualified', 'Converted']);
export const activityTypeEnum = pgEnum('activity_type', ['task', 'call', 'meeting', 'email', 'whatsapp']);
export const priorityEnum = pgEnum('priority', ['Low', 'Medium', 'High']);

const id = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull().default('rep'),
  active: boolean('active').notNull().default(true),
  /** Line manager. Managers see the tasks of everyone below them in this chain. */
  managerId: uuid('manager_id'),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  /** Bumped to sign the user out everywhere (password change, reset, deactivation). */
  sessionVersion: integer('session_version').notNull().default(0),
  theme: text('theme').notNull().default('system'),
  monthlyTarget: doublePrecision('monthly_target'),
  /** Module access. CRM on/off, and the helpdesk role: none | admin | agent | light. */
  crmAccess: boolean('crm_access').notNull().default(true),
  deskRole: text('desk_role').$type<DeskRole>().notNull().default('none'),
  /** Which tickets an agent may see: all | department | team | own (own always includes unassigned in their departments). */
  ticketScope: text('ticket_scope').$type<TicketScope>().notNull().default('own'),
  deskAvailable: boolean('desk_available').notNull().default(true),
  signature: text('signature'),
  calendarToken: text('calendar_token'),
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  recoveryCodes: jsonb('recovery_codes').$type<string[]>().notNull().default([]),
  /** Optional custom role that narrows what the base role may do (export, delete, import, see cost & margin…). */
  customRoleId: uuid('custom_role_id'),
  /** Helpdesk routing: products, vendors and languages this agent handles; empty = any. */
  skills: jsonb('skills').$type<AgentSkills>().notNull().default({ products: [], vendors: [], languages: [] }),
  /** Working hours for assignment; null = always on shift. */
  shift: jsonb('shift').$type<{ days: number[]; start: string; end: string } | null>(),
  /** Sync this person's Outlook mailbox into the CRM. */
  mailSync: boolean('mail_sync').notNull().default(false),
  mailSyncedAt: timestamp('mail_synced_at', { withTimezone: true }),
  createdAt: created(),
}, (t) => ({ emailIdx: uniqueIndex('users_email_idx').on(t.email) }));
export type AgentSkills = { products: string[]; vendors: string[]; languages: string[] };

export const pipelines = pgTable('pipelines', {
  id: id(),
  name: text('name').notNull(),
  recordName: text('record_name').notNull().default('Deal'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: created(),
});

export const subPipelines = pgTable('sub_pipelines', {
  id: id(),
  pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const stages = pgTable('stages', {
  id: id(),
  subPipelineId: uuid('sub_pipeline_id').notNull().references(() => subPipelines.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: stageTypeEnum('type').notNull().default('open'),
  probability: integer('probability'),
  idleDays: integer('idle_days'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const stageRules = pgTable('stage_rules', {
  id: id(),
  pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  fromStageId: uuid('from_stage_id'),
  toStageId: uuid('to_stage_id').notNull(),
  requiredItems: jsonb('required_items').$type<string[]>().notNull().default([]),
});

export const companies = pgTable('companies', {
  id: id(),
  name: text('name').notNull(),
  industry: text('industry'),
  website: text('website'),
  phone: text('phone'),
  city: text('city'),
  country: text('country').default('United Arab Emirates'),
  vatTrn: text('vat_trn'),
  accountType: text('account_type').notNull().default('Prospect'),
  sector: text('sector'),
  emirate: text('emirate'),
  zone: text('zone'),
  tradeLicenceNo: text('trade_licence_no'),
  tradeLicenceExpiry: date('trade_licence_expiry'),
  licenceReminderFor: date('licence_reminder_for'),
  employees: text('employees'),
  annualRevenue: doublePrecision('annual_revenue'),
  linkedin: text('linkedin'),
  customerSince: date('customer_since'),
  tier: text('tier'),
  parentId: uuid('parent_id'),
  custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => ({ ownerIdx: index('companies_owner_idx').on(t.ownerId), parentIdx: index('companies_parent_idx').on(t.parentId), nameIdx: index('companies_name_idx').on(t.name) }));

export const contacts = pgTable('contacts', {
  id: id(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  jobTitle: text('job_title'),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
  email: text('email'),
  phone: text('phone'),
  mobile: text('mobile'),
  whatsapp: text('whatsapp'),
  department: text('department'),
  buyingRole: text('buying_role'),
  linkedin: text('linkedin'),
  language: text('language'),
  birthday: date('birthday'),
  lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
  consent: boolean('consent').notNull().default(false),
  consentAt: timestamp('consent_at', { withTimezone: true }),
  doNotContact: boolean('do_not_contact').notNull().default(false),
  /** Customer portal access (helpdesk). */
  portalEnabled: boolean('portal_enabled').notNull().default(false),
  portalPasswordHash: text('portal_password_hash'),
  portalCompanyAccess: boolean('portal_company_access').notNull().default(false),
  portalVersion: integer('portal_version').notNull().default(0),
  portalLastLogin: timestamp('portal_last_login', { withTimezone: true }),
  /** For contacts at distributor companies: catalog products this person handles. */
  productIds: jsonb('product_ids').$type<string[]>().notNull().default([]),
  source: text('source'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => ({ companyIdx: index('contacts_company_idx').on(t.companyId), emailIdx: index('contacts_email_idx').on(t.email) }));

export const leads = pgTable('leads', {
  id: id(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  companyName: text('company_name'),
  jobTitle: text('job_title'),
  email: text('email'),
  phone: text('phone'),
  source: text('source'),
  status: leadStatusEnum('status').notNull().default('New'),
  notes: text('notes'),
  industry: text('industry'),
  emirate: text('emirate'),
  website: text('website'),
  companySize: text('company_size'),
  budget: doublePrecision('budget'),
  timeline: text('timeline'),
  productInterestId: uuid('product_interest_id'),
  campaign: text('campaign'),
  disqualReason: text('disqual_reason'),
  consent: boolean('consent').notNull().default(false),
  consentAt: timestamp('consent_at', { withTimezone: true }),
  doNotContact: boolean('do_not_contact').notNull().default(false),
  firstContactedAt: timestamp('first_contacted_at', { withTimezone: true }),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  convertedContactId: uuid('converted_contact_id'),
  convertedDealId: uuid('converted_deal_id'),
  convertedAt: timestamp('converted_at', { withTimezone: true }),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => ({ statusIdx: index('leads_status_idx').on(t.status), ownerIdx: index('leads_owner_idx').on(t.ownerId), emailIdx: index('leads_email_idx').on(t.email) }));

export const deals = pgTable('deals', {
  id: id(),
  name: text('name').notNull(),
  pipelineId: uuid('pipeline_id').notNull().references(() => pipelines.id, { onDelete: 'cascade' }),
  subPipelineId: uuid('sub_pipeline_id').notNull().references(() => subPipelines.id, { onDelete: 'cascade' }),
  stageId: uuid('stage_id').notNull().references(() => stages.id),
  amount: doublePrecision('amount'),
  currency: text('currency').notNull().default('AED'),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  closingDate: date('closing_date'),
  priority: priorityEnum('priority').notNull().default('Medium'),
  description: text('description'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  lossReason: text('loss_reason'),
  competitor: text('competitor'),
  winReason: text('win_reason'),
  /** Amount in AED fixed at the moment the deal closed. */
  amountBase: doublePrecision('amount_base'),
  dealType: text('deal_type').notNull().default('New business'),
  leadSource: text('lead_source'),
  nextStep: text('next_step'),
  contractStart: date('contract_start'),
  contractEnd: date('contract_end'),
  termMonths: integer('term_months'),
  recurringValue: doublePrecision('recurring_value'),
  renewalDealId: uuid('renewal_deal_id'),
  tenderNumber: text('tender_number'),
  submissionDeadline: date('submission_deadline'),
  poNumber: text('po_number'),
  paymentTerms: text('payment_terms'),
  distributorId: uuid('distributor_id'),
  resellerId: uuid('reseller_id'),
  dealRegNumber: text('deal_reg_number'),
  dealRegExpiry: date('deal_reg_expiry'),
  dealRegRemindedFor: date('deal_reg_reminded_for'),
  forecastCategory: text('forecast_category').notNull().default('Pipeline'),
  leadId: uuid('lead_id'),
  sourceDealId: uuid('source_deal_id'),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => ({ pipeIdx: index('deals_pipeline_idx').on(t.pipelineId, t.stageId), companyIdx: index('deals_company_idx').on(t.companyId), ownerIdx: index('deals_owner_idx').on(t.ownerId), contactIdx: index('deals_contact_idx').on(t.contactId), closedIdx: index('deals_closed_idx').on(t.closedAt) }));

export const dealEvents = pgTable('deal_events', {
  id: id(),
  dealId: uuid('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // 'stage' | 'change' | 'created' | 'quote'
  stageId: uuid('stage_id'),
  text: text('text'),
  userId: uuid('user_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ dealIdx: index('deal_events_deal_idx').on(t.dealId) }));

export const products = pgTable('products', {
  id: id(),
  name: text('name').notNull(),
  sku: text('sku'),
  category: text('category'),
  unitPrice: doublePrecision('unit_price').notNull().default(0),
  costPrice: doublePrecision('cost_price'),
  billingType: text('billing_type').notNull().default('One-time'),
  unit: text('unit'),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: created(),
});

export const dealItems = pgTable('deal_items', {
  id: id(),
  dealId: uuid('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  qty: doublePrecision('qty').notNull().default(1),
  unitPrice: doublePrecision('unit_price').notNull().default(0),
  discountPct: doublePrecision('discount_pct').notNull().default(0),
});

export const activities = pgTable('activities', {
  id: id(),
  type: activityTypeEnum('type').notNull().default('task'),
  title: text('title').notNull(),
  details: text('details'),
  dueDate: date('due_date'),
  dueTime: text('due_time'),
  done: boolean('done').notNull().default(false),
  doneAt: timestamp('done_at', { withTimezone: true }),
  durationMin: integer('duration_min'),
  location: text('location'),
  attendees: text('attendees'),
  outcome: text('outcome'),
  /** weekly | monthly | quarterly — completing it schedules the next one. */
  repeat: text('repeat'),
  managerAlertedAt: timestamp('manager_alerted_at', { withTimezone: true }),
  relatedType: text('related_type'), // lead | deal | contact | company
  relatedId: uuid('related_id'),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  automation: text('automation'),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: created(),
}, (t) => ({ relIdx: index('activities_rel_idx').on(t.relatedType, t.relatedId), dueIdx: index('activities_due_idx').on(t.dueDate), ownerIdx: index('activities_owner_idx').on(t.ownerId) }));

export const notes = pgTable('notes', {
  id: id(),
  relatedType: text('related_type').notNull(),
  relatedId: uuid('related_id').notNull(),
  body: text('body').notNull(),
  authorId: uuid('author_id'),
  automation: text('automation'),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: created(),
}, (t) => ({ relIdx: index('notes_rel_idx').on(t.relatedType, t.relatedId) }));

export type CustomFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'url' | 'email';
export const customFields = pgTable('custom_fields', {
  id: id(),
  module: text('module').notNull(), // deal | lead | contact | company
  label: text('label').notNull(),
  type: text('type').$type<CustomFieldType>().notNull().default('text'),
  options: jsonb('options').$type<string[]>().notNull().default([]),
  required: boolean('required').notNull().default(false),
  pipelineId: uuid('pipeline_id'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export type TimeEvent = 'deal.closing_soon' | 'deal.idle' | 'deal.contract_ending' | 'lead.untouched';
export type TicketEvent = 'ticket.created' | 'ticket.status' | 'ticket.customer_reply' | 'ticket.idle';
export type AutomationTrigger = { event: 'deal.created' | 'deal.stage' | 'deal.won' | 'deal.lost' | 'lead.created' | 'lead.status' | TimeEvent | TicketEvent; pipelineId?: string; stageId?: string; status?: string; days?: number;
  /** Ticket conditions */ departmentId?: string; priority?: string; channel?: string; keyword?: string; statusId?: string };
export type AutomationActions = {
  task?: { title: string; type: string; dueDays: number };
  assign?: { pool: string[] };
  tag?: string; priority?: string; status?: string; note?: string;
  createDeal?: { pipelineId: string; subPipelineId: string; stageId: string };
  notify?: { to: 'owner' | 'manager' | 'department'; message: string };
  /** Ticket actions */ assignTo?: { mode: 'agent' | 'round_robin' | 'load'; userId?: string; teamId?: string }; setStatusId?: string; setPriority?: string; setTeamId?: string;
};
export const automations = pgTable('automations', {
  id: id(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  trigger: jsonb('trigger').$type<AutomationTrigger>().notNull(),
  actions: jsonb('actions').$type<AutomationActions>().notNull(),
  rrIndex: integer('rr_index').notNull().default(0),
  runCount: integer('run_count').notNull().default(0),
  createdAt: created(),
});

export const scoringRules = pgTable('scoring_rules', {
  id: id(),
  field: text('field').notNull(),
  operator: text('operator').$type<'is' | 'contains' | 'filled'>().notNull(),
  value: text('value'),
  points: integer('points').notNull(),
});

export const emailTemplates = pgTable('email_templates', {
  id: id(),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
});

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

export const reportPages = pgTable('report_pages', {
  id: id(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  tiles: jsonb('tiles').$type<unknown[]>().notNull().default([]),
  updatedAt: updated(),
});

export type User = typeof users.$inferSelect;
export type Pipeline = typeof pipelines.$inferSelect;
export type SubPipeline = typeof subPipelines.$inferSelect;
export type Stage = typeof stages.$inferSelect;
export type StageRule = typeof stageRules.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type DealEvent = typeof dealEvents.$inferSelect;
export type Product = typeof products.$inferSelect;
export type DealItem = typeof dealItems.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type CustomField = typeof customFields.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type ScoringRule = typeof scoringRules.$inferSelect;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type ReportPage = typeof reportPages.$inferSelect;

export const passwordResets = pgTable('password_resets', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: created(),
});

export const auditLog = pgTable('audit_log', {
  id: id(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  userId: uuid('user_id'),
  action: text('action').notNull(),
  entity: text('entity'),
  entityId: text('entity_id'),
  detail: text('detail'),
}, (t) => ({ atIdx: index('audit_at_idx').on(t.at) }));

export const notifications = pgTable('notifications', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body'),
  href: text('href'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: created(),
}, (t) => ({ userIdx: index('notifications_user_idx').on(t.userId, t.readAt) }));

export const automationRuns = pgTable('automation_runs', {
  id: id(),
  automationId: uuid('automation_id').notNull().references(() => automations.id, { onDelete: 'cascade' }),
  recordType: text('record_type').notNull(),
  recordId: uuid('record_id').notNull(),
  /** De-duplication key for time-based triggers, e.g. "closing_soon:2026-11-30". */
  dedupeKey: text('dedupe_key'),
  summary: text('summary'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ dedupeIdx: uniqueIndex('automation_runs_dedupe_idx').on(t.automationId, t.recordId, t.dedupeKey), autoIdx: index('automation_runs_auto_idx').on(t.automationId, t.at) }));

export const savedViews = pgTable('saved_views', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  page: text('page').notNull(),
  name: text('name').notNull(),
  query: text('query').notNull(),
  createdAt: created(),
});

export const favorites = pgTable('favorites', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  recordType: text('record_type').notNull(),
  recordId: uuid('record_id').notNull(),
  label: text('label').notNull(),
  createdAt: created(),
}, (t) => ({ uniq: uniqueIndex('favorites_uniq').on(t.userId, t.recordType, t.recordId) }));

export const attachments = pgTable('attachments', {
  id: id(),
  relatedType: text('related_type').notNull(),
  relatedId: uuid('related_id').notNull(),
  fileName: text('file_name').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  storageKey: text('storage_key').notNull(),
  uploadedBy: uuid('uploaded_by'),
  createdAt: created(),
}, (t) => ({ relIdx: index('attachments_rel_idx').on(t.relatedType, t.relatedId) }));

export type AuditEntry = typeof auditLog.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type SavedView = typeof savedViews.$inferSelect;

/* ======================= RAD Desk (helpdesk) ======================= */
export type DeskRole = 'none' | 'admin' | 'agent' | 'light';
export type TicketScope = 'all' | 'department' | 'team' | 'own';
export type StatusCategory = 'open' | 'onhold' | 'closed';
export type ImapConfig = { host: string; port: number; secure: boolean; user: string; passwordEnc: string; folder: string };

export const departments = pgTable('departments', {
  id: id(),
  name: text('name').notNull(),
  /** Support address customers write to, e.g. support@raidefend.com (used as Reply-To on replies). */
  email: text('email'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  assignMode: text('assign_mode').$type<'manual' | 'round_robin' | 'load'>().notNull().default('manual'),
  rrIndex: integer('rr_index').notNull().default(0),
  autoAck: boolean('auto_ack').notNull().default(true),
  signature: text('signature'),
  imap: jsonb('imap').$type<ImapConfig | null>(),
  imapLastUid: integer('imap_last_uid').notNull().default(0),
  imapStatus: text('imap_status'),
  imapCheckedAt: timestamp('imap_checked_at', { withTimezone: true }),
  createdAt: created(),
});
export const departmentMembers = pgTable('department_members', {
  id: id(),
  departmentId: uuid('department_id').notNull().references(() => departments.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (t) => ({ uniq: uniqueIndex('department_members_uniq').on(t.departmentId, t.userId) }));
export const teams = pgTable('teams', {
  id: id(),
  departmentId: uuid('department_id').notNull().references(() => departments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Team lead: first escalation level for the team's tickets. */
  leadId: uuid('lead_id'),
});
export const teamMembers = pgTable('team_members', {
  id: id(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (t) => ({ uniq: uniqueIndex('team_members_uniq').on(t.teamId, t.userId) }));

export const ticketStatuses = pgTable('ticket_statuses', {
  id: id(),
  name: text('name').notNull(),
  category: text('category').$type<StatusCategory>().notNull().default('open'),
  sortOrder: integer('sort_order').notNull().default(0),
  isDefault: boolean('is_default').notNull().default(false),
});

export type SlaTargets = Record<string, { first: number; resolve: number }>;
export const slaPolicies = pgTable('sla_policies', {
  id: id(),
  name: text('name').notNull(),
  /** Applies when the ticket's department / company tier match (empty = any). First match by sort order wins. */
  departmentId: uuid('department_id'),
  tier: text('tier'),
  /** Minutes per priority: { Urgent: { first: 60, resolve: 480 }, ... } */
  targets: jsonb('targets').$type<SlaTargets>().notNull(),
  businessHours: boolean('business_hours').notNull().default(true),
  warnPct: integer('warn_pct').notNull().default(80),
  escalateTo: text('escalate_to').$type<'manager' | 'department' | 'both'>().notNull().default('both'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const tickets = pgTable('tickets', {
  id: id(),
  number: serial('number').notNull(),
  subject: text('subject').notNull(),
  description: text('description'),
  statusId: uuid('status_id').notNull().references(() => ticketStatuses.id),
  statusCategory: text('status_category').$type<StatusCategory>().notNull().default('open'),
  priority: text('priority').notNull().default('Medium'),
  type: text('type'),
  channel: text('channel').notNull().default('internal'),
  departmentId: uuid('department_id').notNull().references(() => departments.id),
  teamId: uuid('team_id'),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
  dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  category: text('category'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
  requesterName: text('requester_name'),
  requesterEmail: text('requester_email'),
  requesterPhone: text('requester_phone'),
  cc: text('cc'),
  slaPolicyId: uuid('sla_policy_id'),
  firstResponseDueAt: timestamp('first_response_due_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  firstRespondedAt: timestamp('first_responded_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  onHoldSince: timestamp('on_hold_since', { withTimezone: true }),
  slaWarnedAt: timestamp('sla_warned_at', { withTimezone: true }),
  frBreachedAt: timestamp('fr_breached_at', { withTimezone: true }),
  breachedAt: timestamp('breached_at', { withTimezone: true }),
  escalated: boolean('escalated').notNull().default(false),
  parentId: uuid('parent_id'),
  mergedIntoId: uuid('merged_into_id'),
  isSpam: boolean('is_spam').notNull().default(false),
  rating: text('rating'),
  ratingComment: text('rating_comment'),
  ratedAt: timestamp('rated_at', { withTimezone: true }),
  reopenedCount: integer('reopened_count').notNull().default(0),
  lastCustomerReplyAt: timestamp('last_customer_reply_at', { withTimezone: true }),
  lastAgentReplyAt: timestamp('last_agent_reply_at', { withTimezone: true }),
  /** Support contract the ticket is covered by (picked from the company's active contract). */
  contractId: uuid('contract_id'),
  /** Vendor case: the vendor's own reference while it's escalated to them. */
  vendorName: text('vendor_name'),
  vendorCaseNo: text('vendor_case_no'),
  vendorStatus: text('vendor_status'),
  vendorOpenedAt: timestamp('vendor_opened_at', { withTimezone: true }),
  /** Escalation level reached (0 = none, 1 = team lead, 2 = manager, 3 = helpdesk admins). */
  escalationLevel: integer('escalation_level').notNull().default(0),
  /** Major incident: the master ticket has isIncident; linked tickets point to it. */
  isIncident: boolean('is_incident').notNull().default(false),
  incidentId: uuid('incident_id'),
  language: text('language'),
  sentiment: text('sentiment'),
  /** Lead or deal created from this ticket by the sales handoff. */
  handoffLeadId: uuid('handoff_lead_id'),
  createdBy: uuid('created_by'),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => ({
  numIdx: uniqueIndex('tickets_number_idx').on(t.number), catIdx: index('tickets_cat_idx').on(t.statusCategory, t.departmentId),
  asgIdx: index('tickets_assignee_idx').on(t.assigneeId), dueIdx: index('tickets_due_idx').on(t.dueAt), createdIdx: index('tickets_created_idx').on(t.createdAt), incIdx: index('tickets_incident_idx').on(t.incidentId), contractIdx: index('tickets_contract_idx').on(t.contractId), contactIdx: index('tickets_contact_idx').on(t.contactId), companyIdx: index('tickets_company_idx').on(t.companyId),
}));

export const ticketThreads = pgTable('ticket_threads', {
  id: id(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  /** incoming (from customer) | reply (public, to customer) | note (private) | forward */
  kind: text('kind').$type<'incoming' | 'reply' | 'note' | 'forward'>().notNull(),
  authorId: uuid('author_id'),
  fromName: text('from_name'),
  fromEmail: text('from_email'),
  to: text('to'),
  cc: text('cc'),
  body: text('body').notNull(),
  messageId: text('message_id'),
  inReplyTo: text('in_reply_to'),
  channel: text('channel'),
  delivery: text('delivery'),
  /** Files sent with this message (attachment ids). */
  attachmentIds: jsonb('attachment_ids').$type<string[]>().notNull().default([]),
  createdAt: created(),
}, (t) => ({ tIdx: index('ticket_threads_ticket_idx').on(t.ticketId), msgIdx: index('ticket_threads_msg_idx').on(t.messageId) }));

export const ticketEvents = pgTable('ticket_events', {
  id: id(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  userId: uuid('user_id'),
  text: text('text').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ tIdx: index('ticket_events_ticket_idx').on(t.ticketId) }));

export const ticketTime = pgTable('ticket_time', {
  id: id(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  minutes: integer('minutes').notNull(),
  note: text('note'),
  billable: boolean('billable').notNull().default(false),
  date: date('date').notNull(),
  createdAt: created(),
}, (t) => ({ tIdx: index('ticket_time_ticket_idx').on(t.ticketId) }));
export const ticketWatchers = pgTable('ticket_watchers', {
  id: id(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (t) => ({ uniq: uniqueIndex('ticket_watchers_uniq').on(t.ticketId, t.userId) }));
/** Who has a ticket open right now (collision detection). Rows older than a minute are ignored. */
export const ticketPresence = pgTable('ticket_presence', {
  id: id(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  replying: boolean('replying').notNull().default(false),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniq: uniqueIndex('ticket_presence_uniq').on(t.ticketId, t.userId) }));

export const cannedResponses = pgTable('canned_responses', {
  id: id(),
  name: text('name').notNull(),
  departmentId: uuid('department_id'),
  body: text('body').notNull(),
  /** null = shared with everyone */
  ownerId: uuid('owner_id'),
  createdAt: created(),
});

export const kbCategories = pgTable('kb_categories', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
});
export const kbArticles = pgTable('kb_articles', {
  id: id(),
  categoryId: uuid('category_id').references(() => kbCategories.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  body: text('body').notNull(),
  status: text('status').$type<'draft' | 'published'>().notNull().default('draft'),
  visibility: text('visibility').$type<'public' | 'internal'>().notNull().default('public'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  views: integer('views').notNull().default(0),
  helpful: integer('helpful').notNull().default(0),
  notHelpful: integer('not_helpful').notNull().default(0),
  authorId: uuid('author_id'),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => ({ slugIdx: uniqueIndex('kb_articles_slug_idx').on(t.slug) }));

/* ======================= Workspace extras ======================= */
export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userAgent: text('user_agent'),
  ip: text('ip'),
  createdAt: created(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => ({ userIdx: index('sessions_user_idx').on(t.userId) }));

/** Recycle bin: deleted records kept for 30 days with everything needed to restore them. */
export const trash = pgTable('trash', {
  id: id(),
  entity: text('entity').notNull(),
  recordId: uuid('record_id').notNull(),
  label: text('label').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  deletedBy: uuid('deleted_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Change history for leads, contacts and companies (deals keep deal_events). */
export const recordHistory = pgTable('record_history', {
  id: id(),
  recordType: text('record_type').notNull(),
  recordId: uuid('record_id').notNull(),
  userId: uuid('user_id'),
  text: text('text').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ recIdx: index('record_history_rec_idx').on(t.recordType, t.recordId) }));

/** Everyone involved in a deal, with their role. deals.contact_id stays the primary contact. */
export const dealContacts = pgTable('deal_contacts', {
  id: id(),
  dealId: uuid('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  role: text('role'),
}, (t) => ({ uniq: uniqueIndex('deal_contacts_uniq').on(t.dealId, t.contactId) }));

export type Department = typeof departments.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type TicketStatus = typeof ticketStatuses.$inferSelect;
export type SlaPolicy = typeof slaPolicies.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type TicketThread = typeof ticketThreads.$inferSelect;
export type TicketEventRow = typeof ticketEvents.$inferSelect;
export type TicketTime = typeof ticketTime.$inferSelect;
export type CannedResponse = typeof cannedResponses.$inferSelect;
export type KbCategory = typeof kbCategories.$inferSelect;
export type KbArticle = typeof kbArticles.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type TrashItem = typeof trash.$inferSelect;

/* ================= RAD Workspace: licences, contracts, roles, channels ================= */

/** Licences a customer holds (from won deals or entered by hand). Drive automatic renewal deals. */
export const licences = pgTable('licences', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  productName: text('product_name').notNull(),
  vendor: text('vendor'),
  seats: integer('seats').notNull().default(1),
  /** Licence key, encrypted at rest. */
  licenceKey: text('licence_key'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  value: doublePrecision('value'),
  currency: text('currency').notNull().default('AED'),
  status: text('status').$type<'active' | 'expired' | 'cancelled' | 'renewed'>().notNull().default('active'),
  dealId: uuid('deal_id'),
  renewalDealId: uuid('renewal_deal_id'),
  notes: text('notes'),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => ({ coIdx: index('licences_company_idx').on(t.companyId), endIdx: index('licences_end_idx').on(t.endDate) }));

/** Support contract per customer: tier picks the SLA; included hours are drawn down by logged time. */
export const supportContracts = pgTable('support_contracts', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tier: text('tier').notNull().default('Standard'),
  slaPolicyId: uuid('sla_policy_id'),
  hoursIncluded: doublePrecision('hours_included'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  value: doublePrecision('value'),
  currency: text('currency').notNull().default('AED'),
  productIds: jsonb('product_ids').$type<string[]>().notNull().default([]),
  dealId: uuid('deal_id'),
  notes: text('notes'),
  lowHoursWarnedAt: timestamp('low_hours_warned_at', { withTimezone: true }),
  isSample: boolean('is_sample').notNull().default(false),
  createdAt: created(),
}, (t) => ({ coIdx: index('support_contracts_company_idx').on(t.companyId) }));

/** Emails synced from reps' Outlook mailboxes, matched to contacts and deals. */
export const emailLogs = pgTable('email_logs', {
  id: id(),
  userId: uuid('user_id').notNull(),
  messageId: text('message_id').notNull(),
  direction: text('direction').$type<'in' | 'out'>().notNull(),
  subject: text('subject').notNull(),
  snippet: text('snippet'),
  fromEmail: text('from_email'),
  toEmails: text('to_emails'),
  contactId: uuid('contact_id'),
  companyId: uuid('company_id'),
  dealId: uuid('deal_id'),
  webLink: text('web_link'),
  at: timestamp('at', { withTimezone: true }).notNull(),
}, (t) => ({ msgIdx: uniqueIndex('email_logs_msg_idx').on(t.userId, t.messageId), contactIdx: index('email_logs_contact_idx').on(t.contactId), dealIdx: index('email_logs_deal_idx').on(t.dealId), coIdx: index('email_logs_company_idx').on(t.companyId) }));

/** Reports emailed on a schedule (weekly pipeline, win/loss, activities, helpdesk). */
export const reportSchedules = pgTable('report_schedules', {
  id: id(),
  name: text('name').notNull(),
  kind: text('kind').$type<'pipeline' | 'winloss' | 'activities' | 'leaderboard' | 'helpdesk'>().notNull(),
  frequency: text('frequency').$type<'weekly' | 'monthly'>().notNull().default('weekly'),
  /** Weekday 0–6 for weekly, day of month 1–28 for monthly. */
  day: integer('day').notNull().default(1),
  hour: integer('hour').notNull().default(8),
  recipientIds: jsonb('recipient_ids').$type<string[]>().notNull().default([]),
  ownerId: uuid('owner_id'),
  active: boolean('active').notNull().default(true),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  createdAt: created(),
});

/** Custom roles narrow what a base role may do. */
export type RolePermissions = { exportData: boolean; importData: boolean; deleteRecords: boolean; viewCost: boolean; bulkEdit: boolean; viewInsights: boolean; deleteTickets: boolean; mergeTickets: boolean };
export const customRoles = pgTable('custom_roles', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  permissions: jsonb('permissions').$type<RolePermissions>().notNull(),
  createdAt: created(),
});

/** Escalation ladder: after N minutes past due (or at breach), notify and optionally reassign. */
export const escalationRules = pgTable('escalation_rules', {
  id: id(),
  departmentId: uuid('department_id'),
  level: integer('level').notNull(),
  /** Minutes after the resolution due time (0 = at breach). */
  afterMinutes: integer('after_minutes').notNull().default(0),
  target: text('target').$type<'team_lead' | 'manager' | 'desk_admins' | 'user'>().notNull(),
  userId: uuid('user_id'),
  reassign: boolean('reassign').notNull().default(false),
  raisePriority: boolean('raise_priority').notNull().default(false),
  active: boolean('active').notNull().default(true),
});

/** Agent leave: no tickets are auto-assigned during these dates. */
export const agentLeave = pgTable('agent_leave', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  note: text('note'),
});

/** Public status page: outages and maintenance. */
export const statusIncidents = pgTable('status_incidents', {
  id: id(),
  title: text('title').notNull(),
  kind: text('kind').$type<'incident' | 'maintenance'>().notNull().default('incident'),
  status: text('status').$type<'investigating' | 'identified' | 'monitoring' | 'resolved' | 'scheduled' | 'in_progress' | 'completed'>().notNull().default('investigating'),
  impact: text('impact').$type<'minor' | 'major' | 'critical'>().notNull().default('minor'),
  productIds: jsonb('product_ids').$type<string[]>().notNull().default([]),
  components: jsonb('components').$type<string[]>().notNull().default([]),
  updates: jsonb('updates').$type<{ at: string; status: string; text: string }[]>().notNull().default([]),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  ticketId: uuid('ticket_id'),
  createdBy: uuid('created_by'),
  createdAt: created(),
});

/** Customer community: topics and replies, posted by portal customers or agents. */
export const forumTopics = pgTable('forum_topics', {
  id: id(),
  category: text('category').notNull().default('General'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  contactId: uuid('contact_id'),
  userId: uuid('user_id'),
  authorName: text('author_name').notNull(),
  pinned: boolean('pinned').notNull().default(false),
  locked: boolean('locked').notNull().default(false),
  hidden: boolean('hidden').notNull().default(false),
  answerId: uuid('answer_id'),
  views: integer('views').notNull().default(0),
  lastPostAt: timestamp('last_post_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: created(),
});
export const forumPosts = pgTable('forum_posts', {
  id: id(),
  topicId: uuid('topic_id').notNull().references(() => forumTopics.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  contactId: uuid('contact_id'),
  userId: uuid('user_id'),
  authorName: text('author_name').notNull(),
  hidden: boolean('hidden').notNull().default(false),
  createdAt: created(),
}, (t) => ({ topicIdx: index('forum_posts_topic_idx').on(t.topicId) }));

export type Licence = typeof licences.$inferSelect;
export type SupportContract = typeof supportContracts.$inferSelect;
export type EmailLog = typeof emailLogs.$inferSelect;
export type ReportSchedule = typeof reportSchedules.$inferSelect;
export type CustomRole = typeof customRoles.$inferSelect;
export type EscalationRule = typeof escalationRules.$inferSelect;
export type AgentLeave = typeof agentLeave.$inferSelect;
export type StatusIncident = typeof statusIncidents.$inferSelect;
export type ForumTopic = typeof forumTopics.$inferSelect;
export type ForumPost = typeof forumPosts.$inferSelect;
