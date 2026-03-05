import api from "./api.js";
import { API_ROUTES } from "./api-routes.js";

function request(method, path, { params, payload, responseType } = {}) {
  return api
    .request({ method, url: path, params, data: payload, responseType })
    .then((response) => response?.data ?? null);
}

export const TrustCenterApi = {
  listOptions: (params) => request("GET", API_ROUTES.trustCenter.options, { params }),
  listUsers: (params) => request("GET", API_ROUTES.trustCenter.users, { params }),
  getUserSummary: (stateId, params) => request("GET", API_ROUTES.trustCenter.userSummary(stateId), { params }),
  rotateChallenge: (payload) => request("POST", API_ROUTES.trustCenter.rotateChallenge, { payload }),
  simulateCounterKey: (payload) => request("POST", API_ROUTES.trustCenter.simulateCounterKey, { payload }),
  listActivity: (params) => request("GET", API_ROUTES.trustCenter.activity, { params }),
  exportActivity: (params) =>
    api.request({ method: "GET", url: API_ROUTES.trustCenter.activityExport, params, responseType: "blob" }),
  listCounterKeys: (params) => request("GET", API_ROUTES.trustCenter.counterKeys, { params }),
  createCounterKey: (payload) => request("POST", API_ROUTES.trustCenter.counterKeys, { payload }),
  useCounterKey: (id, payload) => request("POST", API_ROUTES.trustCenter.useCounterKey(id), { payload }),
  cancelCounterKey: (id, payload) => request("POST", API_ROUTES.trustCenter.cancelCounterKey(id), { payload }),
  listAudit: (params) => request("GET", API_ROUTES.trustCenter.audit, { params }),
};

export default TrustCenterApi;
