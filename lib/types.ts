export type InvoiceSource = "PAYPAL" | "DEMO";

export type NormalizedInvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED"
  | "REFUNDED_OR_OTHER"
  | "UNKNOWN";

export type Invoice = {
  id: string;
  number?: string;
  status: NormalizedInvoiceStatus;
  paypalStatus: string;
  currency: string;
  totalAmount: number;
  dueDate?: string;
  invoiceDate?: string;
  customerName?: string;
  customerEmail?: string;
  hostedInvoiceUrl?: string;
  source: InvoiceSource;
  lastSyncedAt: string;
  daysOverdue: number;
  isOverdue: boolean;
};

export type ActionStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "EXECUTED"
  | "FAILED"
  | "CANCELLED";

export type ActionResultMode = "SANDBOX" | "DEMO";

export type AgentAction = {
  id: string;
  invoiceId: string;
  actionType: "SEND_INVOICE" | "SEND_REMINDER";
  status: ActionStatus;
  draftSubject: string;
  draftMessage: string;
  rationale: string;
  createdAt: string;
  approvedAt?: string;
  executedAt?: string;
  idempotencyKey: string;
  mode: ActionResultMode;
  invoice?: Invoice;
  paypalResponse?: Record<string, unknown>;
  executionError?: string;
};

export type ActivityKind =
  | "INVOICE_SYNCED"
  | "INVOICE_UPDATED"
  | "RECOMMENDATION"
  | "DRAFT_CREATED"
  | "ACTION_APPROVED"
  | "ACTION_CANCELLED"
  | "ACTION_EXECUTED"
  | "ACTION_FAILED"
  | "WEBHOOK_RECEIVED"
  | "PAYMENT_RECORDED";

export type ActivityEvent = {
  id: string;
  at: string;
  kind: ActivityKind;
  level: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  title: string;
  detail?: string;
  invoiceId?: string;
  actionId?: string;
  source: "PAYPAL" | "DEMO" | "APP" | "LOCAL_TEST";
  metadata?: Record<string, unknown>;
};

export type CurrencyTotals = Record<string, number>;

export type CashflowSummary = {
  outstanding: CurrencyTotals;
  overdue: CurrencyTotals;
  paidThisMonth: CurrencyTotals;
  dueNext7Days: CurrencyTotals;
  dueInHorizon: CurrencyTotals;
  horizonDays: number;
  invoiceCounts: {
    total: number;
    open: number;
    overdue: number;
    paidThisMonth: number;
    dueInHorizon: number;
  };
  paidThisMonthBasis: string;
  notes: string[];
};

export type PriorityResult = {
  invoice: Invoice;
  score: number;
  components: {
    amount: number;
    overdue: number;
    urgency: number;
    confidence: number;
  };
  explanation: string;
};

export type PendingActionView = AgentAction;

export type ToolActivity = {
  tool: string;
  status: "started" | "completed" | "failed";
  summary: string;
};

export type AgentResponse = {
  conversationId: string;
  message: string;
  toolActivities: ToolActivity[];
  pendingActions: AgentAction[];
  aiConfigured: boolean;
};

export type ApiErrorShape = {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
};

export type HealthResponse = {
  ok: boolean;
  mode: "sandbox" | "demo";
  dataSource: InvoiceSource;
  paypalConfigured: boolean;
  aiConfigured: boolean;
  webhookConfigured: boolean;
  databaseConfigured: boolean;
  paypalBaseUrl: string;
  model?: string;
  webhookUrl: string;
};
