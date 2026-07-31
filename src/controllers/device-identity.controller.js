import { getDeviceIdentity } from "../services/device-identity.service.js";

export async function getDeviceIdentityController() {
  return getDeviceIdentity();
}
