/**
 * ALRIS Call Center & Omnichannel — Tipagens Oficiais TypeScript
 */

export interface AlrisPlan {
  id: 'starter' | 'pro' | 'enterprise';
  name: string;
  priceBRL: number;
  maxMembers: number;
  dailyCallsLimit: number;
}

export interface LeadRoutingEntry {
  agent_id: string;
  agent_name: string;
  organization_id: string;
  updated_at: string;
}

export interface WhatsAppSendPayload {
  to: string;
  message: string;
  agent_id?: string;
  agent_name?: string;
  organization_id?: string;
}

export interface MetaEmbeddedSignupSession {
  phone_number_id: string;
  waba_id: string;
}

export interface MercadoPagoPixResponse {
  configured: boolean;
  payment_id?: string;
  status?: 'pending' | 'approved' | 'rejected' | 'cancelled' | string;
  qr_code?: string;
  qr_code_base64?: string;
  ticket_url?: string;
  error?: string;
}

export interface AiMemoryPattern {
  id: string;
  label: string;
  text: string;
  uses: number;
  pinned: boolean;
}

export interface AiSettings {
  count: 3 | 5 | 6;
  tone: 'Consultivo' | 'Direto' | 'Empático' | 'Urgência';
}

export interface AiSuggestionItem {
  label: string;
  text: string;
  fromMemory?: boolean;
}
