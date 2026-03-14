export class DurableWorkflowPort {
  async startWorkflow() {
    throw new Error("DurableWorkflowPort.startWorkflow precisa ser implementado.");
  }

  async signalWorkflow() {
    throw new Error("DurableWorkflowPort.signalWorkflow precisa ser implementado.");
  }
}

