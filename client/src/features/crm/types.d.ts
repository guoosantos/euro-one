export interface CrmClient {
  id: string;
  name: string;
  cnpj?: string | null;
  segment?: string;
  companySize?: "micro" | "pequena" | "media" | "grande";
  city?: string;
  state?: string;
  website?: string;

  mainContactName?: string;
  mainContactRole?: string;
  mainContactPhone?: string;
  mainContactEmail?: string;

  interestLevel?: "baixo" | "medio" | "alto";
  closeProbability?: "baixa" | "media" | "alta";
  tags?: string[];

  hasCompetitorContract?: boolean;
  competitorName?: string;
  competitorContractStart?: string | null;
  competitorContractEnd?: string | null;

  inTrial?: boolean;
  trialProduct?: string;
  trialStart?: string | null;
  trialDurationDays?: number | null;
  trialEnd?: string | null;

  notes?: string;
  relationshipType?: "prospection" | "customer" | "supplier";
  createdByUserId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type CrmContactType = "ligacao" | "whatsapp" | "email" | "reuniao";

export interface CrmContact {
  id: string;
  clientId: string;
  date: string;
  type: CrmContactType;
  internalUser?: string;
  clientContactName?: string;
  clientContactRole?: string;
  summary?: string;
  nextStep?: string;
  nextStepDate?: string | null;
  createdByUserId?: string | null;
  createdAt?: string;
}
