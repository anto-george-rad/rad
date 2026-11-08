/** Fixed pick-lists used across forms (client-safe). */
export const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah', 'Outside UAE'];
export const ACCOUNT_TYPES = ['Prospect', 'Customer', 'Distributor', 'Reseller', 'Partner', 'Competitor', 'Vendor'];
export const SECTORS = ['Government', 'Semi-government', 'Private'];
export const ZONES = ['Mainland', 'Free zone'];
export const EMPLOYEE_RANGES = ['1–10', '11–50', '51–200', '201–500', '501–1,000', '1,000+'];
export const TIERS = ['Strategic', 'Key', 'Standard'];
export const BUYING_ROLES = ['Decision maker', 'Influencer', 'Champion', 'User', 'Blocker'];
export const LANGUAGES = ['English', 'Arabic', 'Other'];
export const TIMELINES = ['This month', '1–3 months', '3–6 months', '6–12 months', 'No timeline'];
export const DEAL_TYPES = ['New business', 'Upsell', 'Renewal'];
export const PAYMENT_TERMS = ['Advance', '30 days', '45 days', '60 days', '90 days', 'Milestones'];
export const BILLING_TYPES = ['One-time', 'Monthly', 'Annual'];
export const OUTCOMES = ['Connected', 'No answer', 'Left voicemail', 'Meeting booked', 'Follow-up needed', 'Not interested'];
export const DISQUAL_REASONS = ['No budget', 'No need', 'Not decision maker', 'Bad contact details', 'Competitor', 'Duplicate', 'Other'];
/** Contacts at these company types can record which products they handle. */
export const PRODUCT_HANDLING_TYPES = ['Distributor'];
/** Helpdesk */
export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
export const TICKET_CHANNELS = ['email', 'web', 'portal', 'phone', 'whatsapp', 'walk-in', 'internal'];
export const CHANNEL_LABEL: Record<string, string> = { email: 'Email', web: 'Web form', portal: 'Portal', phone: 'Phone', whatsapp: 'WhatsApp', 'walk-in': 'Walk-in', internal: 'Internal' };
export const FORECAST_CATEGORIES = ['Pipeline', 'Best case', 'Commit'];
export const DEAL_CONTACT_ROLES = ['Decision maker', 'Technical evaluator', 'Finance', 'Procurement', 'Champion', 'User', 'Influencer'];
export const REPEATS = ['weekly', 'monthly', 'quarterly'];

export const VENDOR_STATUSES = ['Opened with vendor', 'Waiting on vendor', 'Vendor responded', 'Closed by vendor'] as const;
export const STATUS_LABEL: Record<string, string> = { investigating: 'Investigating', identified: 'Identified', monitoring: 'Monitoring', resolved: 'Resolved', scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed' };
export const REPORT_KINDS: [string, string][] = [['pipeline', 'Pipeline'], ['winloss', 'Win/loss'], ['activities', 'Activities'], ['leaderboard', 'Sales leaderboard'], ['helpdesk', 'Helpdesk']];
export const PERMISSION_LABELS: [string, string, string][] = [['exportData', 'Export data', 'Download CSV exports'], ['importData', 'Import data', 'Bulk import from CSV'], ['deleteRecords', 'Delete records', 'Move CRM records to the recycle bin'], ['viewCost', 'See cost & margin', 'Product cost prices and deal margin'], ['bulkEdit', 'Bulk changes', 'Bulk reassign, tag and update'], ['viewInsights', 'Insights', 'Open the Insights report builder'], ['deleteTickets', 'Delete tickets', 'Helpdesk admins only'], ['mergeTickets', 'Merge tickets', 'Merge duplicate tickets']];
