export type PayPalInvoiceName = {
  given_name?: string;
  surname?: string;
  business_name?: string;
  prefix?: string;
  middle_name?: string;
  suffix?: string;
  full_name?: string;
};

export type PayPalInvoice = {
  id: string;
  status: string;
  detail?: {
    invoice_number?: string;
    reference?: string;
    invoice_date?: string;
    currency_code?: string;
    due_date?: string;
    note?: string;
    payment_term?: {
      term_type?: string;
      due_date?: string;
    };
    metadata?: Record<string, unknown>;
  };
  invoicer?: {
    name?: PayPalInvoiceName;
    email_address?: string;
  };
  primary_recipients?: Array<{
    billing_info?: {
      email_address?: string;
      name?: PayPalInvoiceName;
    };
  }>;
  amount?: {
    currency_code?: string;
    value?: string;
  };
  due_amount?: {
    currency_code?: string;
    value?: string;
  };
  links?: Array<{
    href?: string;
    rel?: string;
    method?: string;
  }>;
};

export type PayPalInvoiceListResponse = {
  total_items?: number;
  total_pages?: number;
  items?: PayPalInvoice[];
  links?: Array<{ href?: string; rel?: string; method?: string }>;
};

export type PayPalTokenResponse = {
  scope?: string;
  access_token: string;
  token_type: string;
  app_id?: string;
  expires_in: number;
  nonce?: string;
};

export type PayPalErrorBody = {
  name?: string;
  message?: string;
  error_description?: string;
  debug_id?: string;
  details?: Array<{ field?: string; value?: string; issue?: string; description?: string }>;
  links?: Array<{ href?: string; rel?: string; method?: string }>;
};

export type PayPalWebhookEvent = {
  id: string;
  event_version?: string;
  create_time?: string;
  resource_type?: string;
  event_type: string;
  summary?: string;
  resource?: {
    id?: string;
    invoice_id?: string;
    status?: string;
    invoice?: {
      id?: string;
      status?: string;
      detail?: Record<string, unknown>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  links?: Array<{ href?: string; rel?: string; method?: string }>;
};
