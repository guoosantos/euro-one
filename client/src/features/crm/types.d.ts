export interface CrmContact {
  id: string;
  crmClientId: string;
  clientId: string;
  name: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CrmClient {
  id: string;
  clientId: string;
  name: string;
  tags?: string[];
  interestLevel?: string | null;
  closeProbability?: string | null;
  mainContactName?: string | null;
  mainContactRole?: string | null;
  mainContactPhone?: string | null;
  mainContactEmail?: string | null;
  hasCompetitorContract?: boolean;
  competitorContractEnd?: string | null;
  competitorName?: string | null;
  inTrial?: boolean;
  trialEnd?: string | null;
  primaryContact?: {
    name?: string;
    email?: string;
    phone?: string;
    role?: string;
  } | null;
}
