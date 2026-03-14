import { AI_FLOW_TYPES } from "../domain/flow-types.js";

export class AIService {
  constructor({ orchestrator } = {}) {
    this.orchestrator = orchestrator;
  }

  async chat(req, payload = {}) {
    return this.orchestrator.handleRequest(req, {
      ...payload,
      flowType: AI_FLOW_TYPES.CHAT,
    });
  }

  async summarizeEvent(req, payload = {}) {
    return this.orchestrator.handleRequest(req, {
      ...payload,
      flowType: AI_FLOW_TYPES.SUMMARIZE_EVENT,
    });
  }

  async investigateVehicle(req, payload = {}) {
    return this.orchestrator.handleRequest(req, {
      ...payload,
      flowType: AI_FLOW_TYPES.INVESTIGATE_VEHICLE,
    });
  }

  async prioritizeAlert(req, payload = {}) {
    return this.orchestrator.handleRequest(req, {
      ...payload,
      flowType: AI_FLOW_TYPES.PRIORITIZE_ALERT,
    });
  }

  async learningQuestions(req, payload = {}) {
    return this.orchestrator.handleRequest(req, {
      ...payload,
      flowType: AI_FLOW_TYPES.LEARNING_QUESTIONS,
    });
  }
}
