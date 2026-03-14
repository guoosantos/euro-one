export class AgentRuntimePort {
  async runStep() {
    throw new Error("AgentRuntimePort.runStep precisa ser implementado por um runtime de agentes.");
  }

  async handoff() {
    throw new Error("AgentRuntimePort.handoff precisa ser implementado para suportar handoffs.");
  }
}

