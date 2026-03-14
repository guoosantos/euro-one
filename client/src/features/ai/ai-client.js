import api from "../../lib/api.js";
import { API_ROUTES } from "../../lib/api-routes.js";

async function request(url, { method = "GET", payload, params } = {}) {
  const response = await api.request({
    method,
    url,
    data: payload,
    params,
  });
  return response?.data ?? null;
}

export const AIClient = {
  listTools: () => request(API_ROUTES.ai.tools),
  history: (contextId, params) => request(API_ROUTES.ai.history(contextId), { params }),
  chat: (payload) => request(API_ROUTES.ai.chat, { method: "POST", payload }),
  summarizeEvent: (payload) => request(API_ROUTES.ai.summarizeEvent, { method: "POST", payload }),
  investigateVehicle: (payload) => request(API_ROUTES.ai.investigateVehicle, { method: "POST", payload }),
  prioritizeAlert: (payload) => request(API_ROUTES.ai.prioritizeAlert, { method: "POST", payload }),
  listLearningEntries: (params) => request(API_ROUTES.ai.learning, { params }),
  createLearningEntry: (payload) => request(API_ROUTES.ai.learning, { method: "POST", payload }),
  generateLearningQuestions: (payload) => request(API_ROUTES.ai.learningQuestions, { method: "POST", payload }),
};

export default AIClient;
