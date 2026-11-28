import type { LeadRoutingEntry } from '../types/alris.d.ts';

/**
 * Normaliza telefone brasileiro/internacional removendo pontuação
 * e mantendo apenas dígitos no formato E.164 numérico (ex: 5521967574092).
 */
export function normalizePhoneDigits(rawPhone: string): string {
  return String(rawPhone || '').replace(/\D/g, '');
}

/**
 * Formata mensagem oficial do WhatsApp assinando com o nome do atendente
 * para operações Multi-Atendente em um único número da Meta Cloud API.
 */
export function formatAgentSignedMessage(message: string, agentName?: string): string {
  const clean = String(message || '').trim();
  const signer = String(agentName || '').trim();
  return signer ? `*${signer}:*\n${clean}` : clean;
}

/**
 * Gerenciador tipado de roteamento de clientes para funcionários da empresa.
 */
export class LeadRouter {
  private readonly routes = new Map<string, LeadRoutingEntry>();

  assign(phone: string, agentId: string, agentName: string, organizationId = 'org_default'): LeadRoutingEntry {
    const key = normalizePhoneDigits(phone);
    const entry: LeadRoutingEntry = {
      agent_id: agentId,
      agent_name: agentName || 'Atendimento ALRIS',
      organization_id: organizationId,
      updated_at: new Date().toISOString(),
    };
    this.routes.set(key, entry);
    return entry;
  }

  getOwner(phone: string): LeadRoutingEntry | undefined {
    return this.routes.get(normalizePhoneDigits(phone));
  }
}
