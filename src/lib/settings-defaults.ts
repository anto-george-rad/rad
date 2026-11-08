export type OrgSettings = {
  orgName: string; address: string; vatTrn: string; email: string; phone: string;
  vatPct: number; monthlyTarget: number; baseCurrency: string;
  currencies: Record<string, number>; leadSources: string[]; hotScore: number; warmScore: number;
  lossReasons: string[]; winReasons: string[];
  /** Pipeline that receives automatic renewal deals (by id; empty = the pipeline named "Renewals"). */
  renewalPipelineId: string; renewalDays: number;
  /** Alert a person's manager when their task is this many days overdue (0 = off). */
  overdueAlertDays: number;
  /** Remind the company owner this many days before a trade licence expires (0 = off). */
  licenceReminderDays: number;
  /** Branding. Logos are stored as data: URLs (small PNG/SVG/JPG). */
  logoLight: string; logoDark: string; brandColor: string;
  loginHeadline: string; loginSubtext: string; loginBackground: 'mesh' | 'plain' | 'grid';
  setupDismissed: boolean;
  /** CRM extras */
  minMarginPct: number; dealRegReminderDays: number;
  /** Helpdesk */
  ticketPrefix: string; ticketTypes: string[]; ticketCategories: string[];
  businessHours: BusinessHours;
  csatEnabled: boolean; portalEnabled: boolean; webFormEnabled: boolean; portalTitle: string; portalWelcome: string;
  autoCloseDays: number; reopenOnReply: boolean; requireDualFactorForAdmins: boolean;
  /** Licence register & contracts */
  licenceRenewalDays: number; contractTiers: string[]; supportCostPerHour: number; lowHoursPct: number;
  /** Sales handoff between helpdesk and CRM */
  handoffTicketToLead: boolean; handoffKeywords: string; handoffWonToOnboarding: boolean; onboardingDepartmentId: string;
  /** Public web-to-lead form */
  leadFormEnabled: boolean; leadFormOwnerId: string; leadFormSource: string; leadFormThanks: string; leadFormOrigins: string[];
  /** Helpdesk extras */
  aiTriage: boolean; aiSentiment: boolean; communityEnabled: boolean; forumCategories: string[]; statusComponents: string[]; statusPageEnabled: boolean; ticketLanguages: string[];
  /** Integrations (no secrets here — those live in the server-only 'integrations' row). */
  outlookEnabled: boolean; whatsappEnabled: boolean; whatsappDepartmentId: string;
};
export type BusinessHours = { days: number[]; start: string; end: string; holidays: string[] };
export const DEFAULT_SETTINGS: OrgSettings = {
  orgName: 'Raidefend', address: 'Abu Dhabi, United Arab Emirates', vatTrn: '', email: '', phone: '',
  vatPct: 5, monthlyTarget: 0, baseCurrency: 'AED',
  currencies: { AED: 1, USD: 3.6725, EUR: 3.95, GBP: 4.6, SAR: 0.979, QAR: 1.009, OMR: 9.54, INR: 0.042 },
  leadSources: ['Website', 'Referral', 'LinkedIn', 'Event', 'Cold outreach', 'Partner', 'Inbound call', 'Other'],
  hotScore: 60, warmScore: 30,
  lossReasons: ['Price', 'Lost to competitor', 'No budget', 'No decision', 'Timing', 'Requirements not met', 'Other'],
  winReasons: ['Best technical fit', 'Price', 'Relationship', 'Local support', 'Delivery time', 'Existing customer', 'Other'],
  renewalPipelineId: '', renewalDays: 90, overdueAlertDays: 2, licenceReminderDays: 30,
  logoLight: '', logoDark: '', brandColor: '#4C5BFF',
  loginHeadline: 'Every deal, one clear view.', loginSubtext: 'Sign in to the Raidefend sales workspace.', loginBackground: 'mesh',
  setupDismissed: false,
  minMarginPct: 15, dealRegReminderDays: 14,
  ticketPrefix: 'RD', ticketTypes: ['Question', 'Problem', 'Incident', 'Service request', 'Feature request'],
  ticketCategories: ['Installation', 'Licensing', 'Configuration', 'Bug', 'Billing', 'Training', 'Other'],
  businessHours: { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00', holidays: [] },
  csatEnabled: true, portalEnabled: true, webFormEnabled: true, portalTitle: 'Raidefend Support', portalWelcome: 'Search our help articles or open a request. We usually reply within one business day.',
  autoCloseDays: 7, reopenOnReply: true, requireDualFactorForAdmins: false,
  licenceRenewalDays: 90, contractTiers: ['Standard', 'Premium', 'Strategic'], supportCostPerHour: 150, lowHoursPct: 80,
  handoffTicketToLead: true, handoffKeywords: 'renew|renewal|upgrade|more licen[cs]es|additional (seats|licen[cs]es|users)|quotation|quote|pricing', handoffWonToOnboarding: true, onboardingDepartmentId: '',
  leadFormEnabled: true, leadFormOwnerId: '', leadFormSource: 'Website', leadFormThanks: 'Thank you — our team will contact you within one business day.', leadFormOrigins: [],
  aiTriage: true, aiSentiment: true, communityEnabled: true, forumCategories: ['General', 'How-to', 'Licensing', 'Feature requests'],
  statusComponents: ['Management console', 'Endpoint agents', 'Email security', 'Licensing server', 'Customer portal'], statusPageEnabled: true, ticketLanguages: ['English', 'Arabic', 'Hindi', 'Urdu', 'French'],
  outlookEnabled: false, whatsappEnabled: false, whatsappDepartmentId: '',
};
export const toBase = (amount: number | null | undefined, cur: string | null | undefined, s: OrgSettings) => (+(amount || 0)) * (s.currencies[cur || 'AED'] || 1);
/** Brand colour presets offered in Settings → Branding. */
export const THEME_PRESETS: { name: string; hex: string }[] = [
  { name: 'Indigo', hex: '#4C5BFF' }, { name: 'Ocean', hex: '#0E7CC2' }, { name: 'Emerald', hex: '#0F9D6E' },
  { name: 'Desert', hex: '#C2721A' }, { name: 'Crimson', hex: '#D0384B' }, { name: 'Violet', hex: '#7A4DE0' }, { name: 'Graphite', hex: '#3D4558' },
];
